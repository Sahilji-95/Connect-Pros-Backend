import { Resend } from "resend";
import crypto from "crypto";
import dotenv from "dotenv";

dotenv.config();
const resend = new Resend(process.env.RESEND_API_KEY);

export const generateEmailOtp = () => {
  return crypto.randomInt(100000, 1000000).toString();
};

export const hashEmailOtp = (otp) => {
  return crypto.createHash("sha256").update(otp).digest("hex");
};

export const sendEmailOtp = async (email, otp) => {
  const { data, error } = await resend.emails.send({
    from: process.env.EMAIL_FROM,
    to: email,
    subject: "Verify your email address",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: auto; padding: 24px; color: #24292f;">
        <h2 style="color: #6366f1;">Verify your email</h2>
        <p>Thanks for signing up! Use the code below to verify your email address.</p>
        <div style="background: #f3f4f6; padding: 24px; text-align: center; border-radius: 12px;">
          <div style="font-size: 12px; color: #6b7280;">YOUR VERIFICATION CODE</div>
          <h1 style="letter-spacing: 8px; color: #6366f1;">${otp}</h1>
          <p style="font-size: 13px; color: #6b7280;">This code expires in 5 minutes.</p>
        </div>
        <p style="font-size: 13px; color: #6b7280;">If you didn't request this code, you can ignore this email.</p>
      </div>
    `,
  });

  if (error) {
    throw new Error(error.message || "Failed to send verification email");
  }

  return data;
};
