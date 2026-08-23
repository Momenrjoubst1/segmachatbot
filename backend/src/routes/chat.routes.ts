import { Router } from "express";
import { asyncHandler } from "../utils/express-async-wrapper.js";
import { chatLimiter, newChatLimiter, isThreadOwnedByUser } from "./chat/chat-shared.js";
import { executeChatPipeline } from "../services/chat/chat.pipeline.js";
import chatThreadRoutes from "./chat/chat-thread.routes.js";
import chatTranslateRoutes from "./chat/chat-translate.routes.js";
import chatAttachmentRoutes from "./chat/chat-attachment.routes.js";

const router = Router();

router.post(
  "/",
  chatLimiter,
  // Apply the stricter new-chat limiter ONLY when continuing a REAL owned
  // thread. A client-supplied fake threadId must not downgrade the limit —
  // ownership is verified (Redis-cached, 5-min TTL) before skipping.
  async (req, res, next) => {
    try {
      const threadId = req.body?.threadId;
      const userId = req.user?.id;
      if (threadId && userId && (await isThreadOwnedByUser(userId, String(threadId)))) {
        return next(); // Genuine existing thread — skip the stricter limit
      }
      return newChatLimiter(req, res, next);
    } catch {
      // On lookup failure, fail SAFE: apply the stricter limiter.
      return newChatLimiter(req, res, next);
    }
  },
  asyncHandler(async (req, res) => {
    await executeChatPipeline(req, res);
  }),
);

router.use(chatThreadRoutes);
router.use(chatTranslateRoutes);
router.use(chatAttachmentRoutes);

export default router;
