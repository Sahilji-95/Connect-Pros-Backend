import mongoose from "mongoose";

const ConversationSchema = new mongoose.Schema(
  {
    participants: {
      type: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
      ],
      required: true,
      validate: {
        validator: (participants) =>
          Array.isArray(participants) &&
          participants.length === 2 &&
          participants[0].toString() !== participants[1].toString(),
        message: "A conversation must have exactly two distinct participants.",
      },
    },

    // Sorted user IDs create a stable key for the same pair.
    participantKey: {
      type: String,
      required: true,
      unique: true,
    },

    lastMessage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
      default: null,
    },

    lastMessageAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

ConversationSchema.index({ participants: 1, lastMessageAt: -1 });

const Conversation = mongoose.model("Conversation", ConversationSchema);

export default Conversation;
