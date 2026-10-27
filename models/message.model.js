import mongoose from "mongoose";

const MessageSchema = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
      index: true,
    },

    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    recipientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    clientMessageId: {
      type: String,
      required: true,
      maxlength: 100,
    },

    text: {
      type: String,
      required: true,
      trim: true,
      maxlength: 5000,
    },

    type: {
      type: String,
      enum: ["text"],
      default: "text",
    },

    readAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

MessageSchema.index({
  conversationId: 1,
  createdAt: -1,
  _id: -1,
});

MessageSchema.index({ senderId: 1, clientMessageId: 1 }, { unique: true });

const Message = mongoose.model("Message", MessageSchema);

export default Message;
