import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";

import {
  getConversations,
  createOrGetConversation,
  getConversationMessages,
} from "../controllers/chat.controller.js";

const router = Router();

router.route("/chat/conversations").get(authMiddleware, getConversations);
router
  .route("/chat/conversations")
  .post(authMiddleware, createOrGetConversation);
router
  .route("/chat/conversations/:conversationId/messages")
  .get(authMiddleware, getConversationMessages);

export default router;
