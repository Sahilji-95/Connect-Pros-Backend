import {
  login,
  uploadProfilePicture,
  updateProfile,
  getUserAndProfile,
  updateProfileData,
  getAllUserProfile,
  dwonlaodProfile,
  sendConnecton,
  getMyConnectionReq,
  myAllConnections,
  acceptConnectionRequest,
  getProfileByUsername,
  getConnectionStatus,
  getAllMyConnections,
  deleteConnection,
  logout,
  sendEmailOtpController,
  verifyEmailOtp,
  resendEmailOtp,
  forgotPassword,
  verifyResetOTP,
  resetPassword,
  resendResetPasswordOTP,
  searchUsersByUsername,
} from "../controllers/user.controller.js";

import {
  authLimiter,
  emailOtpLimiter,
  verifyEmailOtpLimiter,
  resetPasswordLimiter,
} from "../middleware/rate-limiter.js";

import { Router } from "express";
import multer from "multer";
import { authMiddleware } from "../middleware/auth.js";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];

    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed!"));
    }
  },
});

router.route("/send-email-otp").post(emailOtpLimiter, sendEmailOtpController);
router.route("/verify-email-otp").post(verifyEmailOtpLimiter, verifyEmailOtp);
router.route("/resend-email-otp").post(emailOtpLimiter, resendEmailOtp);

router.route("/forgot-password").post(emailOtpLimiter, forgotPassword);
router.route("/resend-reset-otp").post(emailOtpLimiter, resendResetPasswordOTP);
router.route("/verify-reset-otp").post(verifyEmailOtpLimiter, verifyResetOTP);
router.route("/reset-password").post(resetPasswordLimiter, resetPassword);

router.route("/login").post(authLimiter, login);
router.route("/logout").post(authMiddleware, logout);

router.route("/user/get_all_user").get(authMiddleware, getAllUserProfile);
router
  .route("/user/get_profile_by_username")
  .get(authMiddleware, getProfileByUsername);
router.route("/user/dwonlaod_resume").get(dwonlaodProfile);

router
  .route("/upload_profile_picture")
  .post(authMiddleware, upload.single("profile_picture"), uploadProfilePicture);

router.route("/update_profile").post(authMiddleware, updateProfile);

router.route("/get_user_and_profile").get(authMiddleware, getUserAndProfile);

router.route("/profile_to_update").post(authMiddleware, updateProfileData);

router
  .route("/user/send_connection_request")
  .post(authMiddleware, sendConnecton);

router
  .route("/user/get_connection_request")
  .get(authMiddleware, getMyConnectionReq);

router
  .route("/user/get_all_connection_request")
  .get(authMiddleware, myAllConnections);

router
  .route("/user/accept_connection_request")
  .post(authMiddleware, acceptConnectionRequest);

router
  .route("/user/connection_status")
  .get(authMiddleware, getConnectionStatus);

router
  .route("/user/get_my_connections")
  .get(authMiddleware, getAllMyConnections);

router.route("/user/delete_connection").post(authMiddleware, deleteConnection);

router.route("/user/search").get(authMiddleware, searchUsersByUsername);

export default router;
