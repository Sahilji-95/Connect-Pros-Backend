import mongoose from "mongoose";

const UserSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    username: {
      type: String,
      required: true,
      unique: true,
    },
    usernameLower: {
      type: String,
      select: false,
    },
    email: {
      type: String,
      required: true,
      unique: true,
    },
    password: {
      type: String,
      required: true,
    },
    active: {
      type: Boolean,
      default: true,
    },
    profilePicture: {
      type: String,
      default:
        "https://res.cloudinary.com/dodj3pvt4/image/upload/v1792695130/linkedin/posts/tm9kvghsbw7xoez27vex.png",
    },
    isEmailVerified: {
      type: Boolean,
      default: false,
    },

    // Online / Offline tracking
    lastSeen: {
      type: Date,
      default: null,
    },

    resetPasswordOTP: {
      type: String,
      default: null,
    },
    resetPasswordOTPExpires: {
      type: Date,
      default: null,
    },
    resetPasswordAttempts: {
      type: Number,
      default: 0,
    },
    resetPasswordLastSentAt: {
      type: Date,
      default: null,
    },
    passwordChangedAt: {
      type: Date,
      default: null,
    },
    resetPasswordTokenHash: {
      type: String,
      default: null,
    },
    resetPasswordTokenExpires: {
      type: Date,
      default: null,
    },
    tokenVersion: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true },
);

UserSchema.index({ usernameLower: 1, _id: 1 });

UserSchema.pre("validate", function () {
  if (typeof this.username === "string") {
    this.usernameLower = this.username.trim().toLowerCase();
  }
});

const User = mongoose.model("User", UserSchema);
export default User;
