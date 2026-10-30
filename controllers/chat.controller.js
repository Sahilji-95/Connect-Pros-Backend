import mongoose from "mongoose";
import Conversation from "../models/conversation.model.js";
import Message from "../models/message.model.js";
import ConnectionReq from "../models/connection.model.js";
import User from "../models/user.model.js";

// Check that both users have an accepted connection.
const hasAcceptedConnection = async (userId, connectionId) => {
  const connection = await ConnectionReq.findOne({
    $or: [
      { userId, connectionId },
      { userId: connectionId, connectionId: userId },
    ],
    status: "accepted",
  }).select("_id");

  return Boolean(connection);
};

// GET /chat/conversations
export const getConversations = async (req, res) => {
  try {
    const userId = req.user._id;

    const conversations = await Conversation.find({
      participants: userId,
    })
      .sort({ lastMessageAt: -1, updatedAt: -1 })
      .populate("participants", "name username profilePicture lastSeen")
      .populate({
        path: "lastMessage",
        select: "senderId recipientId text type readAt createdAt",
      })
      .lean();

    // Fetch all unread message counts in one aggregation.
    const unreadCounts = await Message.aggregate([
      {
        $match: {
          recipientId: new mongoose.Types.ObjectId(userId),
          readAt: null,
          conversationId: {
            $in: conversations.map((conversation) => conversation._id),
          },
        },
      },
      {
        $group: {
          _id: "$conversationId",
          unreadCount: { $sum: 1 },
        },
      },
    ]);

    // Convert aggregation results into a lookup map.
    const unreadCountMap = new Map(
      unreadCounts.map((item) => [item._id.toString(), item.unreadCount]),
    );

    let totalUnreadCount = 0;

    const conversationsWithUnreadCount = conversations.map((conversation) => {
      const unreadCount = unreadCountMap.get(conversation._id.toString()) || 0;

      totalUnreadCount += unreadCount;

      return {
        ...conversation,
        unreadCount,
      };
    });

    return res.status(200).json({
      success: true,
      conversations: conversationsWithUnreadCount,
      totalUnreadCount,
    });
  } catch (error) {
    console.error("Get conversations error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch conversations.",
    });
  }
};

// CREATE OR GET CONVERSATION
// POST /chat/conversations
export const createOrGetConversation = async (req, res) => {
  try {
    const userId = req.user._id;
    const { connectionId } = req.body;

    if (!connectionId || !mongoose.isValidObjectId(connectionId)) {
      return res.status(400).json({
        success: false,
        message: "A valid connection ID is required.",
      });
    }

    const currentUserId = userId.toString();
    const otherUserId = connectionId.toString();

    if (currentUserId === otherUserId) {
      return res.status(400).json({
        success: false,
        message: "You cannot start a conversation with yourself.",
      });
    }

    const otherUser = await User.findOne({
      _id: otherUserId,
      active: true,
    }).select("_id");

    if (!otherUser) {
      return res.status(404).json({
        success: false,
        message: "Connection user not found.",
      });
    }

    const accepted = await hasAcceptedConnection(userId, otherUser._id);

    if (!accepted) {
      return res.status(403).json({
        success: false,
        message: "Chat is allowed only between accepted connections.",
      });
    }

    const participantKey = [currentUserId, otherUserId].sort().join(":");

    let conversation = await Conversation.findOne({
      participantKey,
    });

    let created = false;

    if (!conversation) {
      try {
        conversation = await Conversation.create({
          participants: [userId, otherUser._id].sort((a, b) =>
            a.toString().localeCompare(b.toString()),
          ),
          participantKey,
        });

        created = true;
      } catch (error) {
        // Another request may have created the same conversation.
        if (error.code !== 11000) {
          throw error;
        }

        conversation = await Conversation.findOne({
          participantKey,
        });

        if (!conversation) {
          throw error;
        }
      }
    }

    await conversation.populate(
      "participants",
      "name username profilePicture lastSeen ",
    );

    return res.status(created ? 201 : 200).json({
      success: true,
      created,
      conversation,
    });
  } catch (error) {
    console.error("Create conversation error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to create conversation.",
    });
  }
};

// GET /chat/conversations/:conversationId/messages?limit=30&before=<messageId>
export const getConversationMessages = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user._id;

    if (!mongoose.isValidObjectId(conversationId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid conversation ID.",
      });
    }

    const conversation = await Conversation.findOne({
      _id: conversationId,
      participants: userId,
    }).select("_id participants");

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: "Conversation not found.",
      });
    }

    const rawLimit = req.query.limit;
    let limit = 30;

    if (rawLimit !== undefined) {
      if (typeof rawLimit !== "string" || !/^\d+$/.test(rawLimit)) {
        return res.status(400).json({
          success: false,
          message: "Limit must be a valid integer.",
        });
      }

      const parsedLimit = Number(rawLimit);

      if (!Number.isSafeInteger(parsedLimit) || parsedLimit < 1) {
        return res.status(400).json({
          success: false,
          message: "Limit must be a positive integer.",
        });
      }

      limit = Math.min(parsedLimit, 50);
    }

    const query = {
      conversationId: conversation._id,
    };

    if (req.query.before !== undefined) {
      const cursorId = req.query.before;

      if (!mongoose.isValidObjectId(cursorId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid message cursor.",
        });
      }

      const cursorMessage = await Message.findOne({
        _id: cursorId,
        conversationId: conversation._id,
      }).select("_id createdAt");

      if (!cursorMessage) {
        return res.status(400).json({
          success: false,
          message: "Message cursor not found in this conversation.",
        });
      }

      query.$or = [
        { createdAt: { $lt: cursorMessage.createdAt } },
        {
          createdAt: cursorMessage.createdAt,
          _id: { $lt: cursorMessage._id },
        },
      ];
    }

    const messages = await Message.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .lean();

    const hasMore = messages.length > limit;

    if (hasMore) {
      messages.pop();
    }

    return res.status(200).json({
      success: true,
      messages,
      hasMore,
      nextCursor: hasMore ? messages[messages.length - 1]._id.toString() : null,
    });
  } catch (error) {
    console.error("Get conversation messages error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch messages.",
    });
  }
};
