export interface Contact {
    id: string;
    name: string;
    avatar: string;
    avatarFrame?: string | null;
    chatHanger?: string | null;
    lastMessage: string;
    time: string;
    unread: number;
    online: boolean;
    typing: boolean;
    lastSeen?: string;
    email?: string;
    conversationId?: string; // Newly added to map conversation correctly
    lastMessageSenderId?: string;
    lastMessageTime?: string;
    lastMessageMetadata?: Record<string, any> | null;
}

export interface Message {
    id: string;
    conversationId: string;
    senderId: string;
    content: string;
    timestamp: string;
    status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
    replyToId?: string | null;
    isOptimistic?: boolean;
    tempId?: string;
    createdAt?: string;
    expiresAt?: string | null;
    metadata?: Record<string, any>; // For reactions like ❤️
}

/* ── Supabase Database Types ────────────────────────────────────────── */

export interface DbUser {
    id: string;
    full_name: string | null;
    username: string | null;
    email: string | null;
    avatar_url: string | null;
    is_verified?: boolean;
}

export interface DbConversation {
    id: string;
    is_group: boolean;
    created_at: string;
    updated_at: string;
}

export interface DbConversationParticipant {
    id: string;
    conversation_id: string;
    user_id: string;
    joined_at: string;
}

export interface DbMessage {
    id: string;
    conversation_id: string;
    sender_id: string;
    content: string;
    created_at: string;
    status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
    reply_to_id?: string | null;
    expires_at?: string | null;
    metadata?: Record<string, any> | null;
}

export interface DbFollow {
    follower_id: string;
    following_id: string;
}
