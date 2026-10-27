import User from "../models/user.model.js";
import Profile from "../models/profile.model.js";
import connectionReq from "../models/connection.model.js";
import PendingSignup from "../models/pendingSignup.model.js";

import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import convertUserDataTOPDF from "../utils/pdfHelper.js";
import crypto from "node:crypto";
import { z } from "zod";

import {
  generateEmailOtp,
  hashEmailOtp,
  sendEmailOtp,
} from "../utils/sendEmailOtp.js";

import { sendForgotPasswordOtp } from "../utils/forgotPasswordEmail.js";

import cloudinary from "../config/cloudinary.js";

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
  maxAge: 24 * 60 * 60 * 1000,
  path: "/",
};

const OTP_EXPIRY_MS = 5 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;

export const sendEmailOtpController = async (req, res) => {
  try {
    const schema = z.object({
      name: z.string().trim().min(2).max(60),
      username: z
        .string()
        .trim()
        .regex(
          /^[a-zA-Z0-9_-]{3,20}$/,
          "Username must be 3–20 characters and contain only letters, numbers, underscores, or hyphens.",
        ),
      email: z.string().trim().toLowerCase().email(),
      password: z.string().min(8).max(72),
    });

    const parsed = schema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        message: parsed.error.issues[0].message,
      });
    }

    const { name, username, email, password } = parsed.data;

    // Check for an already registered account.
    const existingUser = await User.findOne({
      $or: [{ email }, { username }],
    });

    if (existingUser) {
      return res.status(409).json({
        message: "Email or username already exists.",
      });
    }

    // Check whether this email or username has a pending signup.
    const existingPending = await PendingSignup.findOne({
      $or: [{ email }, { username }],
    });

    const now = Date.now();

    if (existingPending) {
      // Do not let one email overwrite another person's pending signup.
      if (
        existingPending.email !== email ||
        existingPending.username !== username
      ) {
        return res.status(409).json({
          message:
            "Email or username is already being used in another pending signup.",
        });
      }

      // Apply a 60-second resend cooldown.
      if (existingPending.emailOtpLastSentAt) {
        const elapsed = now - existingPending.emailOtpLastSentAt.getTime();

        if (elapsed < 60 * 1000) {
          const retryAfter = Math.ceil((60 * 1000 - elapsed) / 1000);

          return res.status(429).json({
            message: `Please wait ${retryAfter} seconds before requesting another OTP.`,
            retryAfter,
          });
        }
      }
    }

    const otp = generateEmailOtp();
    const otpHash = hashEmailOtp(otp);
    const hashedPassword = await bcrypt.hash(password, 12);

    if (existingPending) {
      existingPending.name = name;
      existingPending.password = hashedPassword;
      existingPending.emailOtpHash = otpHash;
      existingPending.emailOtpExpiry = new Date(now + 5 * 60 * 1000);
      existingPending.emailOtpAttempts = 0;
      existingPending.emailOtpLastSentAt = new Date(now);

      await existingPending.save();
    } else {
      await PendingSignup.create({
        name,
        username,
        email,
        password: hashedPassword,
        emailOtpHash: otpHash,
        emailOtpExpiry: new Date(now + 5 * 60 * 1000),
        emailOtpAttempts: 0,
        emailOtpLastSentAt: new Date(now),
      });
    }

    try {
      await sendEmailOtp(email, otp);
    } catch (emailError) {
      console.error("OTP email delivery failed:", emailError.message);

      return res.status(502).json({
        message:
          "Unable to send verification email. Please try again after the cooldown.",
      });
    }

    return res.status(200).json({
      message: "Verification code sent to your email.",
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        message: "Email or username already exists.",
      });
    }

    console.error("Send email OTP error:", error.message);

    return res.status(500).json({
      message: "Something went wrong. Please try again.",
    });
  }
};

export const verifyEmailOtp = async (req, res) => {
  try {
    const schema = z.object({
      email: z.string().trim().toLowerCase().email(),
      otp: z.string().regex(/^\d{6}$/, "OTP must be 6 digits"),
    });

    const parsed = schema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        message: parsed.error.issues[0].message,
      });
    }

    const { email, otp } = parsed.data;

    // Only pending signup is checked here.
    const pendingSignup = await PendingSignup.findOne({ email });

    if (!pendingSignup) {
      return res.status(404).json({
        message: "Signup not found or expired. Please sign up again.",
      });
    }

    if (!pendingSignup.emailOtpHash || !pendingSignup.emailOtpExpiry) {
      return res.status(400).json({
        message: "OTP not found. Please request a new OTP.",
      });
    }

    if (pendingSignup.emailOtpExpiry.getTime() <= Date.now()) {
      pendingSignup.emailOtpHash = "";
      pendingSignup.emailOtpExpiry = new Date(0);
      pendingSignup.emailOtpAttempts = 0;
      await pendingSignup.save();

      return res.status(400).json({
        message: "OTP expired. Please request a new OTP.",
      });
    }

    if (pendingSignup.emailOtpAttempts >= 5) {
      return res.status(429).json({
        message: "Too many incorrect attempts. Request a new OTP.",
      });
    }

    const submittedHash = crypto.createHash("sha256").update(otp).digest();

    const storedHash = Buffer.from(pendingSignup.emailOtpHash, "hex");

    const isValid =
      storedHash.length === submittedHash.length &&
      crypto.timingSafeEqual(storedHash, submittedHash);

    if (!isValid) {
      pendingSignup.emailOtpAttempts += 1;

      if (pendingSignup.emailOtpAttempts >= 5) {
        pendingSignup.emailOtpHash = "";
        pendingSignup.emailOtpExpiry = new Date(0);
      }

      await pendingSignup.save();

      return res.status(400).json({
        message:
          pendingSignup.emailOtpAttempts >= 5
            ? "Too many incorrect attempts. Request a new OTP."
            : "Invalid OTP. Please try again.",
        attemptsRemaining: Math.max(0, 5 - pendingSignup.emailOtpAttempts),
      });
    }

    // Prevent duplicate accounts if an account was created meanwhile.
    const existingUser = await User.findOne({
      $or: [
        { email: pendingSignup.email },
        { username: pendingSignup.username },
      ],
    });

    if (existingUser) {
      await PendingSignup.deleteOne({ _id: pendingSignup._id });

      return res.status(409).json({
        message:
          "Email or username is already registered. Please log in or sign up with different details.",
      });
    }

    // Create the actual user only after OTP verification.
    const user = await User.create({
      name: pendingSignup.name,
      username: pendingSignup.username,
      email: pendingSignup.email,
      password: pendingSignup.password, // Already bcrypt-hashed
      isEmailVerified: true,
    });

    try {
      await Profile.create({ userId: user._id });
    } catch (profileError) {
      // Roll back user creation if profile creation fails.
      await User.deleteOne({ _id: user._id });
      throw profileError;
    }

    await PendingSignup.deleteOne({ _id: pendingSignup._id });

    return res.status(200).json({
      message: "Email verified successfully. You can now log in.",
    });
  } catch (error) {
    // MongoDB duplicate-key protection for concurrent requests.
    if (error.code === 11000) {
      return res.status(409).json({
        message: "Email or username is already registered.",
      });
    }

    console.error("Verify email OTP error:", error.message);

    return res.status(500).json({
      message: "Unable to verify email. Please try again.",
    });
  }
};

//SENT FORGET PASSWORD OTP
export const forgotPassword = async (req, res) => {
  try {
    const schema = z.object({
      email: z.string().trim().toLowerCase().email().max(254),
    });

    const parsed = schema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        message: parsed.error.issues[0].message,
      });
    }

    const { email } = parsed.data;

    // OTP is sent only if a registered user exists.
    const user = await User.findOne({ email });

    // Use the same response to avoid revealing registered emails.
    const genericMessage =
      "If an account exists with this email, a password reset code has been sent.";

    if (!user) {
      return res.status(404).json({
        message: "User not found. Please register first.",
      });
    }

    const now = Date.now();

    // Apply a 60-second resend cooldown.
    if (user.resetPasswordLastSentAt) {
      const elapsed = now - user.resetPasswordLastSentAt.getTime();

      if (elapsed < RESEND_COOLDOWN_MS) {
        const retryAfter = Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000);

        return res.status(429).json({
          message: `Please wait ${retryAfter} seconds before requesting another OTP.`,
          retryAfter,
        });
      }
    }

    const otp = generateEmailOtp();
    const otpHash = hashEmailOtp(otp);

    // Save OTP hash and expiry.
    user.resetPasswordOTP = otpHash;
    user.resetPasswordOTPExpires = new Date(now + OTP_EXPIRY_MS);
    user.resetPasswordAttempts = 0;
    user.resetPasswordLastSentAt = new Date(now);

    await user.save();

    try {
      await sendForgotPasswordOtp(email, otp);
    } catch (emailError) {
      console.error("Forgot password OTP delivery failed:", emailError.message);

      // Invalidate the OTP if email delivery fails.
      user.resetPasswordOTP = null;
      user.resetPasswordOTPExpires = null;
      user.resetPasswordAttempts = 0;

      await user.save();

      return res.status(502).json({
        message: "Unable to send the OTP. Please try again later.",
      });
    }

    return res.status(200).json({
      message: genericMessage,
    });
  } catch (error) {
    console.error("Forgot password error:", error.message);

    return res.status(500).json({
      message: "Something went wrong. Please try again.",
    });
  }
};

//VERIFY THE RESET PASSWORD OTP

export const verifyResetOTP = async (req, res) => {
  try {
    const schema = z.object({
      email: z.string().trim().toLowerCase().email(),
      otp: z.string().regex(/^\d{6}$/, "OTP must be 6 digits."),
    });

    const parsed = schema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        message: parsed.error.issues[0].message,
      });
    }

    const { email, otp } = parsed.data;

    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({
        message: "User not found. Please register first.",
      });
    }

    if (!user.resetPasswordOTP || !user.resetPasswordOTPExpires) {
      return res.status(400).json({
        message: "OTP not found. Please request a new OTP.",
      });
    }

    // Check whether the OTP has expired.
    if (user.resetPasswordOTPExpires.getTime() <= Date.now()) {
      user.resetPasswordOTP = null;
      user.resetPasswordOTPExpires = null;
      user.resetPasswordAttempts = 0;

      await user.save();

      return res.status(400).json({
        message: "OTP expired. Please request a new OTP.",
      });
    }

    // Check the maximum allowed incorrect attempts.
    if (user.resetPasswordAttempts >= MAX_OTP_ATTEMPTS) {
      user.resetPasswordOTP = null;
      user.resetPasswordOTPExpires = null;
      user.resetPasswordAttempts = 0;

      await user.save();

      return res.status(429).json({
        message: "Too many incorrect attempts. Please request a new OTP.",
      });
    }

    const submittedHash = crypto.createHash("sha256").update(otp).digest();

    const storedHash = Buffer.from(user.resetPasswordOTP, "hex");

    const isValid =
      /^[a-f0-9]{64}$/i.test(user.resetPasswordOTP) &&
      storedHash.length === submittedHash.length &&
      crypto.timingSafeEqual(storedHash, submittedHash);

    if (!isValid) {
      user.resetPasswordAttempts += 1;

      const attemptsRemaining = MAX_OTP_ATTEMPTS - user.resetPasswordAttempts;

      if (attemptsRemaining <= 0) {
        user.resetPasswordOTP = null;
        user.resetPasswordOTPExpires = null;
        user.resetPasswordAttempts = 0;

        await user.save();

        return res.status(429).json({
          message: "Too many incorrect attempts. Please request a new OTP.",
          attemptsRemaining: 0,
        });
      }

      await user.save();

      return res.status(400).json({
        message: "Invalid OTP. Please try again.",
        attemptsRemaining,
      });
    }

    // Generate a secure, temporary password-reset token.
    const resetToken = crypto.randomBytes(32).toString("hex");

    const resetTokenHash = crypto
      .createHash("sha256")
      .update(resetToken)
      .digest("hex");

    user.resetPasswordTokenHash = resetTokenHash;
    user.resetPasswordTokenExpires = new Date(Date.now() + 10 * 60 * 1000);

    // Consume the OTP after successful verification.
    user.resetPasswordOTP = null;
    user.resetPasswordOTPExpires = null;
    user.resetPasswordAttempts = 0;

    await user.save();

    return res.status(200).json({
      message: "OTP verified successfully.",
      resetToken,
      expiresIn: 600,
    });
  } catch (error) {
    console.error("Verify reset OTP error:", error.message);

    return res.status(500).json({
      message: "Unable to verify OTP. Please try again.",
    });
  }
};

//RESET THE PASSWORD
export const resetPassword = async (req, res) => {
  try {
    const schema = z
      .object({
        resetToken: z.string().regex(/^[a-f0-9]{64}$/i),
        newPassword: z.string().min(8).max(72),
        confirmPassword: z.string().min(8).max(72),
      })
      .refine((data) => data.newPassword === data.confirmPassword, {
        message: "Passwords do not match.",
        path: ["confirmPassword"],
      });

    const parsed = schema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        message: parsed.error.issues[0].message,
      });
    }

    const { resetToken, newPassword } = parsed.data;

    const resetTokenHash = crypto
      .createHash("sha256")
      .update(resetToken)
      .digest("hex");

    // Find the user with the matching, unexpired reset token.
    const user = await User.findOne({
      resetPasswordTokenHash: resetTokenHash,
      resetPasswordTokenExpires: { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).json({
        message:
          "Reset token is invalid or expired. Please verify your OTP again.",
      });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    user.password = hashedPassword;
    user.tokenVersion = (user.tokenVersion ?? 0) + 1;

    user.passwordChangedAt = new Date();

    user.resetPasswordTokenHash = null;
    user.resetPasswordTokenExpires = null;

    user.resetPasswordOTP = null;
    user.resetPasswordOTPExpires = null;
    user.resetPasswordAttempts = 0;

    await user.save();

    res.clearCookie("token", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      path: "/",
    });

    return res.status(200).json({
      message:
        "Password reset successfully. Please log in with your new password.",
    });
  } catch (error) {
    console.error("Reset password error:", error.message);

    return res.status(500).json({
      message: "Unable to reset password. Please try again.",
    });
  }
};

//RESEND RESET PASSWORD OTP

export const resendResetPasswordOTP = async (req, res) => {
  try {
    const schema = z.object({
      email: z.string().trim().toLowerCase().email().max(254),
    });

    const parsed = schema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        message: parsed.error.issues[0].message,
      });
    }

    const { email } = parsed.data;

    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({
        message: "User not found. Please register first.",
      });
    }

    const now = Date.now();

    // 60-second resend cooldown
    if (user.resetPasswordLastSentAt) {
      const elapsed = now - user.resetPasswordLastSentAt.getTime();

      if (elapsed < RESEND_COOLDOWN_MS) {
        const retryAfter = Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000);

        return res.status(429).json({
          message: `Please wait ${retryAfter} seconds before requesting another OTP.`,
          retryAfter,
        });
      }
    }

    const otp = generateEmailOtp();
    const otpHash = hashEmailOtp(otp);

    user.resetPasswordOTP = otpHash;
    user.resetPasswordOTPExpires = new Date(now + OTP_EXPIRY_MS);
    user.resetPasswordAttempts = 0;
    user.resetPasswordLastSentAt = new Date(now);

    // Invalidate any previously issued reset token
    user.resetPasswordTokenHash = null;
    user.resetPasswordTokenExpires = null;

    await user.save();

    try {
      await sendForgotPasswordOtp(email, otp);
    } catch (emailError) {
      console.error("Resend reset password OTP failed:", emailError.message);

      user.resetPasswordOTP = null;
      user.resetPasswordOTPExpires = null;
      user.resetPasswordAttempts = 0;
      await user.save();

      return res.status(502).json({
        message: "Unable to send OTP. Please try again later.",
      });
    }

    return res.status(200).json({
      message: "A new OTP has been sent to your email.",
      expiresIn: OTP_EXPIRY_MS / 1000,
      retryAfter: RESEND_COOLDOWN_MS / 1000,
    });
  } catch (error) {
    console.error("Resend reset OTP error:", error.message);

    return res.status(500).json({
      message: "Something went wrong. Please try again.",
    });
  }
};

// LOGIN: JWT + HTTPONLY COOKIE

export const login = async (req, res) => {
  try {
    const loginSchema = z.object({
      email: z.string().trim().toLowerCase().email(),
      password: z.string().min(1, "Password is required").max(72),
    });

    const parsed = loginSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        message: parsed.error.issues[0].message,
      });
    }

    const { email, password } = parsed.data;

    const user = await User.findOne({
      email,
      active: true,
    });

    if (!user) {
      return res.status(401).json({
        message: "Invalid credentials",
      });
    }

    const passwordMatches = await bcrypt.compare(password, user.password);

    if (!passwordMatches) {
      return res.status(401).json({
        message: "Invalid credentials",
      });
    }

    if (user.isEmailVerified !== true) {
      return res.status(403).json({
        message: "Please verify your email before logging in.",
        code: "EMAIL_NOT_VERIFIED",
      });
    }

    if (!process.env.JWT_SECRET) {
      throw new Error("JWT_SECRET is not configured");
    }

    const token = jwt.sign(
      {
        userId: user._id.toString(),
        tokenVersion: user.tokenVersion ?? 0,
      },
      process.env.JWT_SECRET,
      { expiresIn: "1d" },
    );

    return res
      .cookie("token", token, cookieOptions)
      .status(200)
      .json({
        message: "Login successful",
        user: {
          _id: user._id,
          name: user.name,
          username: user.username,
          email: user.email,
          profilePicture: user.profilePicture,
        },
      });
  } catch (error) {
    console.error("Login error:", error);

    return res.status(500).json({
      message: "Something went wrong. Please try again.",
    });
  }
};

export const resendEmailOtp = async (req, res) => {
  try {
    const schema = z.object({
      email: z.string().trim().toLowerCase().email(),
    });

    const parsed = schema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        message: parsed.error.issues[0].message,
      });
    }

    const { email } = parsed.data;

    // Find the temporary signup, not the actual User.
    const pendingSignup = await PendingSignup.findOne({ email });

    if (!pendingSignup) {
      return res.status(404).json({
        message: "Signup not found or expired. Please sign up again.",
      });
    }

    const now = Date.now();
    const cooldownMs = 60 * 1000;

    // Prevent repeated OTP requests within 60 seconds.
    if (pendingSignup.emailOtpLastSentAt) {
      const elapsed = now - pendingSignup.emailOtpLastSentAt.getTime();

      if (elapsed < cooldownMs) {
        const retryAfter = Math.ceil((cooldownMs - elapsed) / 1000);

        return res.status(429).json({
          message: `Please wait ${retryAfter} seconds before requesting another OTP.`,
          retryAfter,
        });
      }
    }

    const otp = generateEmailOtp();
    const otpHash = hashEmailOtp(otp);

    pendingSignup.emailOtpHash = otpHash;
    pendingSignup.emailOtpExpiry = new Date(now + 5 * 60 * 1000);
    pendingSignup.emailOtpAttempts = 0;
    pendingSignup.emailOtpLastSentAt = new Date(now);

    await pendingSignup.save();

    try {
      await sendEmailOtp(email, otp);
    } catch (emailError) {
      // Invalidate the OTP if delivery fails.
      pendingSignup.emailOtpHash = "";
      pendingSignup.emailOtpExpiry = new Date(0);
      pendingSignup.emailOtpAttempts = 0;
      pendingSignup.emailOtpLastSentAt = null;

      await pendingSignup.save();

      console.error("Resend OTP email error:", emailError.message);

      return res.status(502).json({
        message: "Unable to resend OTP. Please try again.",
      });
    }

    return res.status(200).json({
      message: "A new verification code has been sent.",
    });
  } catch (error) {
    console.error("Resend OTP controller error:", error);

    return res.status(500).json({
      message: "Something went wrong. Please try again.",
    });
  }
};
// LOGOUT
export const logout = async (req, res) => {
  try {
    // Invalidate existing JWT sessions
    await User.updateOne({ _id: req.user._id }, { $inc: { tokenVersion: 1 } });

    // Disconnect active sockets for this user
    const io = req.app.get("io");

    if (io) {
      io.in(`user:${req.user._id}`).disconnectSockets(true);
    }

    return res.clearCookie("token", cookieOptions).status(200).json({
      success: true,
      message: "Logout successful",
    });
  } catch (error) {
    console.error("Logout error:", error);

    return res.status(500).json({
      success: false,
      message: "Logout failed. Please try again.",
    });
  }
};

// CURRENT LOGGED-IN USER
export const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select(
      "_id name username email profilePicture active",
    );

    if (!user) {
      return res.status(401).json({
        message: "User not found",
      });
    }

    return res.status(200).json({ user });
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};

// UPLOAD PROFILE PICTURE

export const uploadProfilePicture = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        message: "Profile picture is required",
      });
    }

    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }
    // Upload image buffer directly to Cloudinary
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: "linkedin/profile-pictures",
          resource_type: "image",
        },
        (error, result) => {
          if (error) return reject(error);
          resolve(result);
        },
      );

      stream.end(req.file.buffer);
    });

    // Save Cloudinary URL in MongoDB
    user.profilePicture = result.secure_url;
    await user.save();

    return res.status(200).json({
      message: "Profile picture updated",
      profilePicture: user.profilePicture,
    });
  } catch (error) {
    console.error("Profile picture upload error:", error);

    return res.status(500).json({
      message: "Failed to upload profile picture",
    });
  }
};

// UPDATE USER DETAILS
export const updateProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    const { name, username, email } = req.body;
    const updates = {};

    if (name !== undefined) updates.name = name;

    if (username !== undefined) {
      updates.username = username.trim();
    }

    if (email !== undefined) {
      updates.email = email.trim().toLowerCase();
    }

    const conditions = [];

    if (updates.username) {
      conditions.push({ username: updates.username });
    }

    if (updates.email) {
      conditions.push({ email: updates.email });
    }

    if (conditions.length > 0) {
      const existingUser = await User.findOne({
        _id: { $ne: user._id },
        $or: conditions,
      });

      if (existingUser) {
        return res.status(409).json({
          message: "Email or username already exists",
        });
      }
    }

    Object.assign(user, updates);
    await user.save();

    return res.status(200).json({
      message: "User profile updated",
      user: {
        _id: user._id,
        name: user.name,
        username: user.username,
        email: user.email,
        profilePicture: user.profilePicture,
      },
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        message: "Email or username already exists",
      });
    }

    return res.status(500).json({
      message: error.message,
    });
  }
};

// GET CURRENT USER AND PROFILE
export const getUserAndProfile = async (req, res) => {
  try {
    const userProfile = await Profile.findOne({
      userId: req.user._id,
    }).populate("userId", "name email username profilePicture");

    if (!userProfile) {
      return res.status(404).json({
        message: "Profile not found",
      });
    }

    return res.status(200).json({
      profile: userProfile,
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};

// UPDATE CURRENT USER'S PROFILE DATA
export const updateProfileData = async (req, res) => {
  try {
    const profile = await Profile.findOne({
      userId: req.user._id,
    });

    if (!profile) {
      return res.status(404).json({
        message: "Profile not found",
      });
    }

    const { bio, currentPost, pastWork, education } = req.body;

    if (bio !== undefined) {
      profile.bio = bio;
    }

    if (currentPost !== undefined) {
      profile.currentPost = currentPost;
    }

    if (pastWork !== undefined) {
      profile.pastWork = pastWork;
    }

    if (education !== undefined) {
      profile.education = education;
    }

    await profile.save();

    return res.status(200).json({
      message: "Profile updated successfully",
      profile,
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};

// GET ALL PUBLIC USER PROFILES
export const getAllUserProfile = async (req, res) => {
  try {
    const allUser = await Profile.find({})
      .populate({
        path: "userId",
        select: "username profilePicture email name",
        match: { _id: { $ne: null } },
      })
      .lean();

    const validUsers = allUser.filter((profile) => profile.userId !== null);

    return res.status(200).json(validUsers);
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};

// DOWNLOAD PROFILE PDF
export const dwonlaodProfile = async (req, res) => {
  try {
    const userId = req.query.id;

    if (!userId) {
      return res.status(400).json({
        message: "User ID is required",
      });
    }

    const userProfile = await Profile.findOne({
      userId,
    }).populate("userId", "username email name profilePicture");

    if (!userProfile) {
      return res.status(404).json({
        message: "Profile not found",
      });
    }

    const outputPath = await convertUserDataTOPDF(userProfile);

    return res.status(200).json({
      message: outputPath,
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};

// SEND CONNECTION REQUEST
export const sendConnecton = async (req, res) => {
  try {
    const { connectionId } = req.body;
    const userId = req.user._id;

    if (!connectionId) {
      return res.status(400).json({
        message: "Connection ID is required",
      });
    }

    const connectionUser = await User.findById(connectionId);

    if (!connectionUser || !connectionUser.active) {
      return res.status(404).json({
        message: "Connection user not found",
      });
    }

    if (userId.equals(connectionUser._id)) {
      return res.status(400).json({
        message: "You cannot connect with yourself",
      });
    }

    const existing = await connectionReq.findOne({
      $or: [
        { userId, connectionId: connectionUser._id },
        { userId: connectionUser._id, connectionId: userId },
      ],
      status: { $in: ["pending", "accepted"] },
    });

    if (existing) {
      return res.status(409).json({
        message: "Request already exists",
      });
    }

    await connectionReq.deleteMany({
      userId,
      connectionId: connectionUser._id,
      status: "rejected",
    });

    const connection = await connectionReq.create({
      userId,
      connectionId: connectionUser._id,
      status: "pending",
    });

    return res.status(201).json({
      message: "Request sent",
      connection,
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};

// GET CONNECTION REQUESTS SENT BY CURRENT USER
export const getMyConnectionReq = async (req, res) => {
  try {
    const allConnections = await connectionReq
      .find({ userId: req.user._id })
      .populate("connectionId", "name username email profilePicture");

    return res.status(200).json({ allConnections });
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};

// GET PENDING REQUESTS RECEIVED BY CURRENT USER
export const myAllConnections = async (req, res) => {
  try {
    const connections = await connectionReq
      .find({
        connectionId: req.user._id,
        status: "pending",
      })
      .populate("userId", "name username email profilePicture");

    return res.status(200).json(connections);
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};

export const getAllMyConnections = async (req, res) => {
  try {
    const userId = req.user._id;

    const connections = await connectionReq
      .find({
        $or: [
          { userId, status: "accepted" },
          { connectionId: userId, status: "accepted" },
        ],
      })
      .populate("userId", "name username email profilePicture")
      .populate("connectionId", "name username email profilePicture");

    const myConnections = connections.map((connection) => {
      const isSender = connection.userId._id.equals(userId);

      return isSender ? connection.connectionId : connection.userId;
    });

    return res.status(200).json({
      success: true,
      connections: myConnections,
    });
  } catch (error) {
    console.error("Get connections error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch connections",
    });
  }
};

export const deleteConnection = async (req, res) => {
  try {
    const { connectionId } = req.body;
    const userId = req.user._id;

    if (!connectionId) {
      return res.status(400).json({ message: "Connection ID is required" });
    }

    const connection = await connectionReq.findOne({
      status: "accepted",
      $or: [
        { userId, connectionId },
        { userId: connectionId, connectionId: userId },
      ],
    });

    if (!connection) {
      return res.status(404).json({ message: "Connection not found" });
    }

    await connection.deleteOne();

    return res.status(200).json({ message: "Connection deleted" });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// ACCEPT OR REJECT CONNECTION REQUEST
export const acceptConnectionRequest = async (req, res) => {
  try {
    const { requestId, action_type } = req.body;

    if (!requestId || !["accept", "reject"].includes(action_type)) {
      return res.status(400).json({
        message: "Invalid request ID or action",
      });
    }

    const connection = await connectionReq.findOne({
      _id: requestId,
      connectionId: req.user._id,
      status: "pending",
    });

    if (!connection) {
      return res.status(404).json({
        message: "Pending request not found",
      });
    }

    connection.status = action_type === "accept" ? "accepted" : "rejected";

    await connection.save();

    return res.status(200).json({
      message:
        action_type === "accept"
          ? "Connection accepted"
          : "Connection rejected",
      status: connection.status,
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};

// GET CONNECTION STATUS
export const getConnectionStatus = async (req, res) => {
  try {
    const { connectionId } = req.query;
    const currentUserId = req.user._id;

    if (!connectionId) {
      return res.status(400).json({
        message: "Connection ID is required",
      });
    }

    const otherUser = await User.findById(connectionId).select("_id");

    if (!otherUser) {
      return res.status(404).json({
        message: "Profile user not found",
      });
    }

    if (currentUserId.equals(otherUser._id)) {
      return res.status(200).json({
        status: "self",
      });
    }

    const connection = await connectionReq.findOne({
      $or: [
        {
          userId: currentUserId,
          connectionId: otherUser._id,
        },
        {
          userId: otherUser._id,
          connectionId: currentUserId,
        },
      ],
      status: { $in: ["pending", "accepted"] },
    });

    if (!connection) {
      return res.status(200).json({
        status: "none",
      });
    }

    if (connection.status === "accepted") {
      return res.status(200).json({
        status: "accepted",
        requestId: connection._id,
      });
    }

    if (connection.userId.equals(currentUserId)) {
      return res.status(200).json({
        status: "pending",
        requestId: connection._id,
      });
    }

    return res.status(200).json({
      status: "received",
      requestId: connection._id,
    });
  } catch (error) {
    console.error("getConnectionStatus error:", error);

    return res.status(500).json({
      message: "Failed to fetch connection status",
    });
  }
};

// PUBLIC PROFILE BY USERNAME
export const getProfileByUsername = async (req, res) => {
  try {
    const { username } = req.query;

    if (!username) {
      return res.status(400).json({
        message: "Username is required",
      });
    }

    const user = await User.findOne({
      username,
      active: true,
    });

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    const userProfile = await Profile.findOne({
      userId: user._id,
    }).populate("userId", "username email name profilePicture");

    if (!userProfile) {
      return res.status(404).json({
        message: "Profile not found",
      });
    }

    return res.status(200).json(userProfile);
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};
