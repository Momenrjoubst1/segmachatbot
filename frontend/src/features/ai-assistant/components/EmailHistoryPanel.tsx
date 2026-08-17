import { useState, useEffect, useCallback } from 'react';
import { useAuthContext } from '../../../context/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { Trash2, RefreshCw, Mail, Search, X, ChevronRight } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingStates';

interface Email {
  id: string;
  recipients: string[];
  cc?: string[];
  subject: string;
  body_preview: string;
  full_body?: string;
  status: 'sent' | 'failed';
  provider: string;
  created_at: string;
  read_count?: number;
}

interface EmailHistoryPanelProps {
  onClose: () => void;
  onAskBot: (message: string) => void;
}

export function EmailHistoryPanel({ onClose, onAskBot }: EmailHistoryPanelProps) {
  const { user } = useAuthContext();
  const [emails, setEmails] = useState<Email[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'sent' | 'failed'>('all');
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);

  const fetchEmails = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('email_audit_logs')
        .select('*')
        .eq('user_id', user?.id)
        .or('is_deleted.is.null,is_deleted.eq.false')
        .order('created_at', { ascending: false })
        .limit(50);

      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      setEmails(data || []);
    } catch (error) {
      console.error('Error fetching emails:', error);
    } finally {
      setLoading(false);
    }
  }, [user?.id, statusFilter]);

  useEffect(() => {
    if (user) {
      fetchEmails();
    }
  }, [user, statusFilter, fetchEmails]);

  const handleDelete = (emailId: string) => {
    onAskBot(`Delete email ${emailId}`);
    onClose();
  };

  const handleResend = (emailId: string) => {
    onAskBot(`Resend email ${emailId}`);
    onClose();
  };

  const filteredEmails = emails.filter(email => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      email.subject.toLowerCase().includes(query) ||
      email.body_preview?.toLowerCase().includes(query) ||
      email.recipients.some(r => r.toLowerCase().includes(query))
    );
  });

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  if (selectedEmail) {
    return (
      <div className="flex flex-col h-full bg-background">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <button
            onClick={() => setSelectedEmail(null)}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ChevronRight className="w-4 h-4" />
            Back
          </button>
          <button onClick={onClose} className="p-2 hover:bg-accent rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Email Details */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div>
            <h2 className="text-xl font-bold mb-2">{selectedEmail.subject}</h2>
            <div className="space-y-1 text-sm text-muted-foreground">
              <p><span className="font-medium">To:</span> {selectedEmail.recipients.join(', ')}</p>
              {selectedEmail.cc && selectedEmail.cc.length > 0 && (
                <p><span className="font-medium">Cc:</span> {selectedEmail.cc.join(', ')}</p>
              )}
              <p><span className="font-medium">Date:</span> {new Date(selectedEmail.created_at).toLocaleString('en-US')}</p>
              <p>
                <span className="font-medium">Status:</span>{' '}
                <span className={selectedEmail.status === 'sent' ? 'text-green-600' : 'text-red-600'}>
                  {selectedEmail.status === 'sent' ? 'Sent ✓' : 'Failed ✗'}
                </span>
              </p>
            </div>
          </div>

          <div className="border-t pt-4">
            <div className="whitespace-pre-wrap text-sm">
              {selectedEmail.full_body || selectedEmail.body_preview || 'No content'}
            </div>
          </div>

          {(selectedEmail.read_count ?? 0) > 0 && (
            <div className="text-xs text-muted-foreground border-t pt-4">
              📊 Read {selectedEmail.read_count} times
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="p-4 border-t flex gap-2">
          <button
            onClick={() => handleResend(selectedEmail.id)}
            className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
          >
            Resend
          </button>
          <button
            onClick={() => handleDelete(selectedEmail.id)}
            className="px-4 py-2 bg-destructive text-destructive-foreground rounded-lg hover:bg-destructive/90"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <Mail className="w-5 h-5" />
          Email History
        </h2>
        <button onClick={onClose} className="p-2 hover:bg-accent rounded-lg">
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Filters */}
      <div className="p-4 space-y-3 border-b">
        {/* Search */}
        <div className="relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pr-10 pl-3 py-2 bg-accent rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>

        {/* Status Filter */}
        <div className="flex gap-2">
          <button
            onClick={() => setStatusFilter('all')}
            className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              statusFilter === 'all'
                ? 'bg-primary text-primary-foreground'
                : 'bg-accent hover:bg-accent/80'
            }`}
          >
            All
          </button>
          <button
            onClick={() => setStatusFilter('sent')}
            className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              statusFilter === 'sent'
                ? 'bg-green-600 text-white'
                : 'bg-accent hover:bg-accent/80'
            }`}
          >
            Sent
          </button>
          <button
            onClick={() => setStatusFilter('failed')}
            className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              statusFilter === 'failed'
                ? 'bg-red-600 text-white'
                : 'bg-accent hover:bg-accent/80'
            }`}
          >
            Failed
          </button>
          <button
            onClick={fetchEmails}
            disabled={loading}
            className="px-3 py-1.5 bg-accent rounded-lg hover:bg-accent/80 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Email List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <LoadingSpinner size="md" />
          </div>
        ) : filteredEmails.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <Mail className="w-12 h-12 mb-2 opacity-50" />
            <p className="text-sm">No emails found</p>
          </div>
        ) : (
          <div className="p-2 space-y-2">
            {filteredEmails.map((email) => (
              <div
                key={email.id}
                onClick={() => setSelectedEmail(email)}
                className="p-3 bg-accent hover:bg-accent/80 rounded-lg cursor-pointer transition-colors"
              >
                <div className="flex items-start justify-between mb-1">
                  <h3 className="font-semibold text-sm truncate flex-1">{email.subject}</h3>
                  <span
                    className={`px-2 py-0.5 text-xs rounded-full ml-2 ${
                      email.status === 'sent'
                        ? 'bg-green-100 text-green-800'
                        : 'bg-red-100 text-red-800'
                    }`}
                  >
                    {email.status === 'sent' ? '✓' : '✗'}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground truncate mb-1">
                  {email.recipients.join(', ')}
                </p>
                <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
                  {email.body_preview || 'No content'}
                </p>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{formatDate(email.created_at)}</span>
                  {(email.read_count ?? 0) > 0 && <span>📖 {email.read_count}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
