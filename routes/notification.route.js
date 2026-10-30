import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";
import {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from "../controllers/notification.controller.js";

const router = Router();

router.get("/notification", authMiddleware, getNotifications);

router.patch(
  "/notification/read-all",
  authMiddleware,
  markAllNotificationsRead,
);

router.patch("/notification/:id/read", authMiddleware, markNotificationRead);

export default router;
