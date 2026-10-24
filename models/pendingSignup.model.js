import mongoose from "mongoose";

const PendingSignupSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    username: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
    },
    emailOtpHash: {
      type: String,
      required: true,
    },
    emailOtpExpiry: {
      type: Date,
      required: true,
    },
    emailOtpAttempts: {
      type: Number,
      default: 0,
    },
    emailOtpLastSentAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true },
);

// Automatically remove pending signups after 24 hours.
PendingSignupSchema.index({ createdAt: 1 }, { expireAfterSeconds: 86400 });

const PendingSignup = mongoose.model("PendingSignup", PendingSignupSchema);

export default PendingSignup;
