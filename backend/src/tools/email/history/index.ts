import { z } from "zod";
import { registerTool } from "../../tool-registry.js";
import { 
  getEmailHistory, 
  getEmailDetails, 
  deleteEmailFromHistory,
  resendEmail,
  getEmailStats
} from "../send/sender.js";

// ========================================
// GET EMAIL HISTORY
// ========================================
registerTool("get_email_history", {
  description: "Get the user's email history with optional filtering. Shows sent and failed emails.",
  inputSchema: z.object({
    limit: z.number().optional().describe("Maximum number of emails to return (default: 50)"),
    status: z.enum(['sent', 'failed']).optional().describe("Filter by email status"),
    searchQuery: z.string().optional().describe("Search in subject or body"),
    includeDeleted: z.boolean().optional().describe("Include deleted emails (default: false)"),
  }),
  execute: async (args: any) => {
    const userId = args.__userId;
    if (!userId) {
      return JSON.stringify({ status: "error", message: "User authentication required." });
    }

    const emails = await getEmailHistory(userId, {
      limit: args.limit,
      status: args.status,
      searchQuery: args.searchQuery,
      includeDeleted: args.includeDeleted,
    });

    return JSON.stringify({
      status: "success",
      count: emails.length,
      emails: emails.map(email => ({
        id: email.id,
        recipients: email.recipients,
        cc: email.cc,
        subject: email.subject,
        bodyPreview: email.body_preview || email.body || 'No preview available',
        status: email.status,
        provider: email.provider,
        sentAt: email.created_at,
        readCount: email.read_count || 0,
        isDeleted: email.is_deleted || false,
      })),
    });
  },
});

// ========================================
// GET EMAIL DETAILS
// ========================================
registerTool("get_email_details", {
  description: "Get detailed information about a specific email including full body.",
  inputSchema: z.object({
    emailId: z.string().describe("The ID of the email to retrieve"),
  }),
  execute: async (args: any) => {
    const userId = args.__userId;
    if (!userId) {
      return JSON.stringify({ status: "error", message: "User authentication required." });
    }

    const email = await getEmailDetails(args.emailId, userId);
    
    if (!email) {
      return JSON.stringify({ status: "error", message: "Email not found." });
    }

    return JSON.stringify({
      status: "success",
      email: {
        id: email.id,
        recipients: email.recipients,
        cc: email.cc,
        bccCount: email.bcc_count,
        subject: email.subject,
        body: email.full_body || email.body_preview || email.body || 'No content available',
        status: email.status,
        provider: email.provider,
        sentAt: email.created_at,
        readCount: email.read_count || 0,
        lastReadAt: email.last_read_at,
        isDeleted: email.is_deleted || false,
        deletedAt: email.deleted_at,
        error: email.error,
      },
    });
  },
});

// ========================================
// DELETE EMAIL
// ========================================
registerTool("delete_email", {
  description: "Delete an email from history. This is a soft delete and can be restored later.",
  inputSchema: z.object({
    emailId: z.string().describe("The ID of the email to delete"),
  }),
  execute: async (args: any) => {
    const userId = args.__userId;
    if (!userId) {
      return JSON.stringify({ status: "error", message: "User authentication required." });
    }

    const success = await deleteEmailFromHistory(args.emailId, userId);
    
    if (success) {
      return JSON.stringify({ 
        status: "success", 
        message: "Email deleted successfully. You can restore it later if needed." 
      });
    }

    return JSON.stringify({ status: "error", message: "Failed to delete email." });
  },
});

// ========================================
// RESEND EMAIL
// ========================================
registerTool("resend_email", {
  description: "Resend a previously sent email to the same recipients.",
  inputSchema: z.object({
    emailId: z.string().describe("The ID of the email to resend"),
  }),
  execute: async (args: any) => {
    const userId = args.__userId;
    if (!userId) {
      return JSON.stringify({ status: "error", message: "User authentication required." });
    }

    return await resendEmail(args.emailId, userId);
  },
});

// ========================================
// GET EMAIL STATS
// ========================================
registerTool("get_email_stats", {
  description: "Get email statistics for the user (total sent, failed, success rate, etc.).",
  inputSchema: z.object({}),
  execute: async (args: any) => {
    const userId = args.__userId;
    if (!userId) {
      return JSON.stringify({ status: "error", message: "User authentication required." });
    }

    const stats = await getEmailStats(userId);
    
    if (!stats) {
      return JSON.stringify({ status: "error", message: "Failed to retrieve statistics." });
    }

    return JSON.stringify({
      status: "success",
      stats: {
        totalEmails: stats.total,
        sentSuccessfully: stats.sent,
        failed: stats.failed,
        successRate: `${stats.successRate}%`,
        emailsLast7Days: stats.recentEmails,
      },
    });
  },
});
