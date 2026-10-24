import User from "../models/user.model.js";
import Profile from "../models/profile.model.js";
import connectionReq from "../models/connection.model.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import convertUserDataTOPDF from "../utils/pdfHelper.js";
import { z } from "zod";

import cloudinary from "../config/cloudinary.js";

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
  maxAge: 24 * 60 * 60 * 1000,
  path: "/",
};

// REGISTER
export const register = async (req, res) => {
  try {
    const registerSchema = z.object({
      name: z.string().trim().min(2).max(60),
      username: z
        .string()
        .trim()
        .regex(/^[a-zA-Z0-9_]{3,20}$/),
      email: z.string().trim().toLowerCase().email(),
      password: z.string().min(8).max(72),
    });

    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.issues[0].message });
    }
    const { name, email, password, username } = parsed.data;

    if (!name || !email || !password || !username) {
      return res.status(400).json({
        message: "All fields are required",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const normalizedUsername = username.trim();

    const exists = await User.findOne({
      $or: [{ email: normalizedEmail }, { username: normalizedUsername }],
    });

    if (exists) {
      return res.status(409).json({
        message: "Email or username already exists",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const newUser = await User.create({
      name,
      email: normalizedEmail,
      username: normalizedUsername,
      password: hashedPassword,
    });

    await Profile.create({
      userId: newUser._id,
    });

    return res.status(201).json({
      message: "Profile created Please Log in To Explore the Services",
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

// LOGIN: JWT + HTTPONLY COOKIE
export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        message: "Email and password are required",
      });
    }

    const user = await User.findOne({
      email: email.trim().toLowerCase(),
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

    if (!process.env.JWT_SECRET) {
      throw new Error("JWT_SECRET is not configured");
    }

    const token = jwt.sign(
      { userId: user._id.toString() },
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
    return res.status(500).json({
      message: error.message,
    });
  }
};

// LOGOUT
export const logout = (req, res) => {
  return res.clearCookie("token", cookieOptions).status(200).json({
    message: "Logout successful",
  });
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
