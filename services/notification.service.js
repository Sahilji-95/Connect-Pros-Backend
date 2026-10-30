import mongoose from "mongoose";
import Notification from "../models/notification.model.js";

// Only these notification types should be visible.
const ALLOWED_NOTIFICATION_TYPES = [
  "post_like",
  "post_comment",
  "connection_request",
  "new_post",
  "connection_accepted",
];
const userRoom = (userId) => `user:${userId}`;

export const createAndEmitNotification = async (
  io,
  { recipientId, senderId, type, message, relatedId = null },
) => {
  try {
    // Never notify a user about their own action.
    if (
      !recipientId ||
      !senderId ||
      recipientId.toString() === senderId.toString()
    ) {
      return null;
    }

    const notification = await Notification.create({
      recipient: recipientId,
      sender: senderId,
      type,
      message,
      relatedId,
    });

    const populated = await Notification.findById(notification._id)
      .populate("sender", "name username profilePicture")
      .lean();

    if (io) {
      io.to(userRoom(recipientId.toString())).emit(
        "notification:new",
        populated,
      );
    }

    return populated;
  } catch (error) {
    // Notification failure must not break the primary action.
    console.error("Notification creation error:", error.message);
    return null;
  }
};

export const getNotifications = async (req, res) => {
  try {
    const recipient = req.user._id;

    const notificationFilter = {
      recipient,
      type: { $in: ALLOWED_NOTIFICATION_TYPES },
    };

    const [notifications, unreadCount] = await Promise.all([
      Notification.find(notificationFilter)
        .populate("sender", "name username profilePicture")
        .sort({ createdAt: -1 })
        .limit(50)
        .lean(),

      Notification.countDocuments({
        ...notificationFilter,
        isRead: false,
      }),
    ]);

    return res.status(200).json({
      success: true,
      notifications,
      unreadCount,
    });
  } catch (error) {
    console.error("Get notifications error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch notifications",
    });
  }
};

export const markNotificationRead = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid notification ID",
      });
    }

    const notification = await Notification.findOneAndUpdate(
      {
        _id: id,
        recipient: req.user._id,
        type: { $in: ALLOWED_NOTIFICATION_TYPES },
      },
      { $set: { isRead: true } },
      { new: true },
    );

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: "Notification not found",
      });
    }

    return res.status(200).json({
      success: true,
      notification,
    });
  } catch (error) {
    console.error("Mark notification read error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to update notification",
    });
  }
};

export const markAllNotificationsRead = async (req, res) => {
  try {
    await Notification.updateMany(
      {
        recipient: req.user._id,
        type: { $in: ALLOWED_NOTIFICATION_TYPES },
        isRead: false,
      },
      { $set: { isRead: true } },
    );

    return res.status(200).json({
      success: true,
      message: "All notifications marked as read",
    });
  } catch (error) {
    console.error("Mark all notifications read error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to update notifications",
    });
  }
};
