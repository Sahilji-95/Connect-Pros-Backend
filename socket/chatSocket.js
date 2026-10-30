import mongoose from "mongoose";
import Conversation from "../models/conversation.model.js";
import Message from "../models/message.model.js";
import ConnectionReq from "../models/connection.model.js";
import User from "../models/user.model.js";

const userRoom = (userId) => `user:${userId}`;

const RATE_LIMIT_WINDOW_MS = 10_000;
const MAX_CHAT_MESSAGES = 10;
const MAX_CHAT_READS = 10;

// In-memory state for this Node.js process.
// For multiple backend instances, move presence to Redis.
const chatRateLimits = new Map();
const onlineUsers = new Map(); // userId -> Set(socketId)
const activeConversations = new Map(); // socketId -> conversationId

const isRateLimited = (userId, eventType, maxRequests) => {
  const now = Date.now();

  if (chatRateLimits.size > 10_000) {
    for (const [key, entry] of chatRateLimits) {
      if (now >= entry.resetAt) {
        chatRateLimits.delete(key);
      }
    }
  }

  const key = `${userId}:${eventType}`;
  const current = chatRateLimits.get(key);

  if (!current || now >= current.resetAt) {
    chatRateLimits.set(key, {
      count: 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
    });

    return false;
  }

  if (current.count >= maxRequests) return true;

  current.count += 1;
  return false;
};

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

const isSessionValid = async (socket) => {
  try {
    const { userId, tokenVersion } = socket.data.user ?? {};

    if (!userId || !Number.isInteger(tokenVersion)) return false;

    const user = await User.findById(userId)
      .select("_id active tokenVersion")
      .lean();

    return Boolean(
      user &&
      user.active !== false &&
      (user.tokenVersion ?? 0) === tokenVersion,
    );
  } catch (error) {
    console.error("Socket session validation error:", error);
    return false;
  }
};

const sendError = (message, code) => ({
  success: false,
  code,
  message,
});

const addOnlineSocket = (userId, socketId) => {
  let sockets = onlineUsers.get(userId);

  if (!sockets) {
    sockets = new Set();
    onlineUsers.set(userId, sockets);
  }

  const wasOffline = sockets.size === 0;
  sockets.add(socketId);

  return wasOffline;
};

const removeOnlineSocket = (userId, socketId) => {
  const sockets = onlineUsers.get(userId);

  if (!sockets) return false;

  sockets.delete(socketId);

  if (sockets.size > 0) return false;

  onlineUsers.delete(userId);
  return true;
};

const isUserViewingConversation = (userId, conversationId) => {
  const sockets = onlineUsers.get(userId);

  if (!sockets) return false;

  for (const socketId of sockets) {
    if (activeConversations.get(socketId) === conversationId) {
      return true;
    }
  }

  return false;
};

const getOnlineUserIds = () => Array.from(onlineUsers.keys());

export const registerChatSocket = (io) => {
  io.on("connection", (socket) => {
    socket.on("presence:get", () => {
      socket.emit("presence:initial", {
        onlineUserIds: getOnlineUserIds(),
      });
    });

    const senderId = socket.data.user?.userId;

    if (!senderId) {
      socket.disconnect(true);
      return;
    }

    socket.join(userRoom(senderId));

    const becameOnline = addOnlineSocket(senderId, socket.id);

    // Send current online users to this newly connected socket.
    socket.emit("presence:initial", {
      onlineUserIds: getOnlineUserIds(),
    });

    // Broadcast only when this user changes from offline to online.
    if (becameOnline) {
      io.emit("presence:update", {
        userId: senderId,
        online: true,
      });
    }

    // SET ACTIVE CONVERSATION FOR THIS SOCKET/TAB
    socket.on("chat:active", async (payload, acknowledge) => {
      const ack = typeof acknowledge === "function" ? acknowledge : () => {};

      try {
        if (!(await isSessionValid(socket))) {
          socket.disconnect(true);

          return ack(
            sendError(
              "Session expired. Please login again.",
              "SESSION_EXPIRED",
            ),
          );
        }

        const { conversationId } = payload ?? {};

        if (!mongoose.isValidObjectId(conversationId)) {
          return ack(sendError("Invalid conversation ID.", "INVALID_INPUT"));
        }

        const conversation = await Conversation.findOne({
          _id: conversationId,
          participants: senderId,
        }).select("_id");

        if (!conversation) {
          return ack(
            sendError("Conversation not found.", "CONVERSATION_NOT_FOUND"),
          );
        }

        activeConversations.set(socket.id, conversation._id.toString());

        return ack({ success: true });
      } catch (error) {
        console.error("Set active conversation error:", error);

        return ack(
          sendError("Unable to set active conversation.", "ACTIVE_FAILED"),
        );
      }
    });

    // CLEAR ACTIVE CONVERSATION FOR THIS SOCKET/TAB
    socket.on("chat:inactive", () => {
      activeConversations.delete(socket.id);
    });

    // SEND MESSAGE
    socket.on("chat:send", async (payload, acknowledge) => {
      const ack = typeof acknowledge === "function" ? acknowledge : () => {};

      try {
        if (!(await isSessionValid(socket))) {
          socket.disconnect(true);

          return ack(
            sendError(
              "Session expired. Please login again.",
              "SESSION_EXPIRED",
            ),
          );
        }

        const { conversationId, clientMessageId, text } = payload ?? {};

        if (
          !mongoose.isValidObjectId(conversationId) ||
          typeof clientMessageId !== "string" ||
          clientMessageId.trim().length === 0 ||
          clientMessageId.length > 100 ||
          typeof text !== "string" ||
          text.trim().length === 0 ||
          text.trim().length > 5000
        ) {
          return ack(
            sendError("Invalid conversation or message data.", "INVALID_INPUT"),
          );
        }

        const cleanText = text.trim();
        const cleanClientMessageId = clientMessageId.trim();

        const conversation = await Conversation.findOne({
          _id: conversationId,
          participants: senderId,
        }).select("_id participants");

        if (!conversation) {
          return ack(
            sendError("Conversation not found.", "CONVERSATION_NOT_FOUND"),
          );
        }

        const recipient = conversation.participants.find(
          (participant) => participant.toString() !== senderId,
        );

        if (!recipient) {
          return ack(
            sendError(
              "Invalid conversation participants.",
              "INVALID_CONVERSATION",
            ),
          );
        }

        const recipientId = recipient.toString();

        const accepted = await hasAcceptedConnection(senderId, recipientId);

        if (!accepted) {
          return ack(
            sendError(
              "Messages are allowed only between accepted connections.",
              "CONNECTION_REQUIRED",
            ),
          );
        }

        // Idempotency check before consuming the message limit.
        const existing = await Message.findOne({
          senderId,
          clientMessageId: cleanClientMessageId,
        }).lean();

        if (existing) {
          if (
            existing.conversationId.toString() !== conversationId ||
            existing.text !== cleanText
          ) {
            return ack(
              sendError(
                "Message ID was already used for different content.",
                "MESSAGE_ID_CONFLICT",
              ),
            );
          }

          return ack({
            success: true,
            duplicate: true,
            message: existing,
          });
        }

        if (isRateLimited(senderId, "chat:send", MAX_CHAT_MESSAGES)) {
          return ack(
            sendError(
              "Too many messages. Please wait a few seconds.",
              "RATE_LIMITED",
            ),
          );
        }

        let savedMessage;

        try {
          savedMessage = await Message.create({
            conversationId: conversation._id,
            senderId,
            recipientId,
            clientMessageId: cleanClientMessageId,
            text: cleanText,
            type: "text",
          });
        } catch (error) {
          if (error.code === 11000) {
            const duplicate = await Message.findOne({
              senderId,
              clientMessageId: cleanClientMessageId,
            }).lean();

            if (
              duplicate &&
              duplicate.conversationId.toString() === conversationId &&
              duplicate.text === cleanText
            ) {
              return ack({
                success: true,
                duplicate: true,
                message: duplicate,
              });
            }

            return ack(
              sendError("Message ID conflict.", "MESSAGE_ID_CONFLICT"),
            );
          }

          throw error;
        }

        await Conversation.updateOne(
          { _id: conversation._id },
          {
            $set: {
              lastMessage: savedMessage._id,
              lastMessageAt: savedMessage.createdAt,
            },
          },
        );

        const message = savedMessage.toObject();

        // Preserve existing delivery to sender and recipient rooms.
        io.to(userRoom(senderId))
          .to(userRoom(recipientId))
          .emit("chat:message", message);

        // Popup only when no connected socket is actively viewing
        // this exact conversation.
        const recipientIsViewing = isUserViewingConversation(
          recipientId,
          conversation._id.toString(),
        );

        if (!recipientIsViewing) {
          const sender = await User.findById(senderId)
            .select("_id name username profilePicture")
            .lean();

          io.to(userRoom(recipientId)).emit("chat:popup", {
            conversationId: conversation._id.toString(),
            message,
            sender: sender
              ? {
                  _id: sender._id,
                  name: sender.name,
                  username: sender.username,
                  profilePicture: sender.profilePicture,
                }
              : {
                  _id: senderId,
                  name: "New message",
                },
          });
        }

        // No persistent new_message notification is created.
        // The chat:popup event handles temporary in-app popups.

        return ack({
          success: true,
          duplicate: false,
          message,
        });
      } catch (error) {
        console.error("Chat send error:", error);

        return ack(
          sendError("Unable to send message. Please try again.", "SEND_FAILED"),
        );
      }
    });

    // MARK SELECTED MESSAGES AS READ
    socket.on("chat:read", async (payload, acknowledge) => {
      const ack = typeof acknowledge === "function" ? acknowledge : () => {};

      try {
        if (!(await isSessionValid(socket))) {
          socket.disconnect(true);

          return ack(
            sendError(
              "Session expired. Please login again.",
              "SESSION_EXPIRED",
            ),
          );
        }

        const { conversationId, messageIds } = payload ?? {};

        if (
          !mongoose.isValidObjectId(conversationId) ||
          !Array.isArray(messageIds) ||
          messageIds.length === 0 ||
          messageIds.length > 100 ||
          !messageIds.every((id) => mongoose.isValidObjectId(id)) ||
          new Set(messageIds.map(String)).size !== messageIds.length
        ) {
          return ack(
            sendError("Invalid conversation or message IDs.", "INVALID_INPUT"),
          );
        }

        if (isRateLimited(senderId, "chat:read", MAX_CHAT_READS)) {
          return ack(
            sendError(
              "Too many read requests. Please wait a few seconds.",
              "RATE_LIMITED",
            ),
          );
        }

        const conversation = await Conversation.findOne({
          _id: conversationId,
          participants: senderId,
        }).select("_id participants");

        if (!conversation) {
          return ack(
            sendError("Conversation not found.", "CONVERSATION_NOT_FOUND"),
          );
        }

        const otherParticipant = conversation.participants.find(
          (participant) => participant.toString() !== senderId,
        );

        if (!otherParticipant) {
          return ack(
            sendError("Invalid conversation.", "INVALID_CONVERSATION"),
          );
        }

        const otherUserId = otherParticipant.toString();

        const accepted = await hasAcceptedConnection(senderId, otherUserId);

        if (!accepted) {
          return ack(
            sendError(
              "Read receipts require an accepted connection.",
              "CONNECTION_REQUIRED",
            ),
          );
        }

        const filter = {
          _id: {
            $in: messageIds.map((id) => new mongoose.Types.ObjectId(id)),
          },
          conversationId: conversation._id,
          senderId: otherUserId,
          recipientId: senderId,
          readAt: null,
        };

        const unreadMessages = await Message.find(filter).select("_id").lean();

        if (unreadMessages.length === 0) {
          return ack({
            success: true,
            readAt: null,
            messageIds: [],
          });
        }

        const readAt = new Date();

        await Message.updateMany(filter, {
          $set: { readAt },
        });

        const updatedMessageIds = unreadMessages.map((message) =>
          message._id.toString(),
        );

        io.to(userRoom(otherUserId)).emit("chat:read_receipt", {
          conversationId: conversation._id.toString(),
          readerId: senderId,
          messageIds: updatedMessageIds,
          readAt,
        });

        return ack({
          success: true,
          readAt,
          messageIds: updatedMessageIds,
        });
      } catch (error) {
        console.error("Chat read receipt error:", error);

        return ack(
          sendError("Unable to mark messages as read.", "READ_FAILED"),
        );
      }
    });

    // CLEAN UP ONLY THIS SOCKET'S PRESENCE/ACTIVE CHAT STATE
    socket.on("disconnect", async () => {
      activeConversations.delete(socket.id);

      const becameOffline = removeOnlineSocket(senderId, socket.id);

      // User is offline only when their last socket disconnects.
      if (becameOffline) {
        const lastSeen = new Date();

        try {
          await User.updateOne(
            { _id: senderId },
            {
              $set: { lastSeen },
            },
          );

          io.emit("presence:update", {
            userId: senderId,
            online: false,
            lastSeen,
          });
        } catch (error) {
          console.error("Update lastSeen error:", error);

          // Still broadcast offline status if DB update fails.
          io.emit("presence:update", {
            userId: senderId,
            online: false,
            lastSeen,
          });
        }
      }
    });
  });
};
