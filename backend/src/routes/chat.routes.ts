import { Router } from "express";
import { asyncHandler } from "../utils/express-async-wrapper.js";
import { chatLimiter, newChatLimiter } from "./chat/chat-shared.js";
import { executeChatPipeline } from "../services/chat/chat.pipeline.js";
import chatThreadRoutes from "./chat/chat-thread.routes.js";
import chatTranslateRoutes from "./chat/chat-translate.routes.js";

const router = Router();

router.post(
  "/",
  chatLimiter,
  // Apply the stricter new-chat limiter ONLY when starting a fresh conversation
  // (no threadId means the pipeline will create a new session).  This prevents
  // abuse while keeping the normal 30 msg/min limit for ongoing threads.
  (req, res, next) => {
    if (req.body?.threadId) {
      return next(); // Existing thread — skip the stricter limit
    }
    // Invoke newChatLimiter as standard Express middleware
    return newChatLimiter(req, res, next);
  },
  asyncHandler(async (req, res) => {
    await executeChatPipeline(req, res);
  }),
);

router.use(chatThreadRoutes);
router.use(chatTranslateRoutes);

export default router;
