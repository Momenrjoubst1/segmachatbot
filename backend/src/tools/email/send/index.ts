import { registerTool } from "../../tool-registry.js";
import { executeSendEmail, isEmailAvailable, sendEmailSchema } from "./sender.js";

registerTool("send_email", {
  description: "Send an email message as plain text by default. Only include the 'html' parameter if the user explicitly requests HTML formatting or a specific design. Do NOT use without the user's explicit consent. The user must confirm before sending.",
  inputSchema: sendEmailSchema,
  execute: async (args: any) => {
    return executeSendEmail(args, args.__userId || "anonymous");
  },
});

export { isEmailAvailable };
