import jwt from "jsonwebtoken";
import * as cookie from "cookie";
import User from "../models/user.model.js";
import mongoose from "mongoose";

export const socketAuth = async (socket, next) => {
  try {
    const cookieHeader = socket.handshake.headers.cookie || "";

    if (!cookieHeader) {
      return next(new Error("Authentication required. Please login."));
    }

    const cookies = cookie.parseCookie(cookieHeader);
    const token = cookies.token;

    if (!token) {
      return next(new Error("Authentication required. Please login."));
    }

    if (!process.env.JWT_SECRET) {
      console.error("JWT_SECRET is not configured.");
      return next(new Error("Authentication service unavailable."));
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (
      !decoded.userId ||
      !Number.isInteger(decoded.tokenVersion) ||
      !decoded.iat
    ) {
      return next(new Error("Invalid authentication token."));
    }

    const user = await User.findById(decoded.userId).select(
      "_id active tokenVersion",
    );

    if (!user || user.active === false) {
      return next(new Error("User is unavailable. Please login again."));
    }

    if (decoded.tokenVersion !== (user.tokenVersion ?? 0)) {
      return next(new Error("Session expired. Please login again."));
    }

    // Store only the verified identity needed by chat handlers.
    socket.data.user = {
      userId: user._id.toString(),
      tokenVersion: user.tokenVersion ?? 0,
    };

    return next();
  } catch (error) {
    if (
      error.name === "JsonWebTokenError" ||
      error.name === "TokenExpiredError" ||
      error.name === "NotBeforeError"
    ) {
      return next(new Error("Invalid or expired session. Please login again."));
    }

    console.error("Socket authentication error:", error);
    return next(new Error("Unable to authenticate socket."));
  }
};
