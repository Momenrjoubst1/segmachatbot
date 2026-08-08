import { createContext, useContext } from "react";

interface ConnectionContextValue {
  retryMessage: () => void;
  sendApprovalDecision?: (toolCallId: string, approved: boolean, feedback?: string) => void;
}

export const ConnectionContext = createContext<ConnectionContextValue>({
  retryMessage: () => {},
  sendApprovalDecision: () => {},
});


export const useConnectionContext = () => useContext(ConnectionContext);
