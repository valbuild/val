import { useRef } from "react";
import { ChevronLeft } from "lucide-react";
import { AIChat } from "./AIChat";
import type { AIChatHandle } from "./AIChat";
import { useAI } from "../hooks/useAI";
import { useValMode } from "./ValProvider";
import { useNavigation } from "./ValRouter";
import { Button } from "./designSystem/button";
import { PublishButton } from "./PublishButton";

export function ChatFullscreen() {
  const { navigateBack } = useNavigation();
  const chatRef = useRef<AIChatHandle | null>(null);
  const {
    sendMessage,
    uploadAiImage,
    isConnected,
    authError,
    newSession,
    sessions,
    currentSessionId,
    getSessions,
    setSessionName,
    loadSession,
  } = useAI(chatRef);
  const mode = useValMode();
  return (
    <div className="flex flex-col h-[100dvh] w-screen bg-bg-primary text-fg-primary">
      <div className="shrink-0 h-14 flex items-center justify-between px-3 border-b border-border-primary">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={navigateBack}
          aria-label="Close chat"
        >
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <div className="text-sm font-medium">AI Chat</div>
        <div className="flex items-center gap-1">
          <PublishButton />
        </div>
      </div>
      <div className="flex-1 min-h-0">
        <AIChat
          ref={chatRef}
          onSendMessage={sendMessage}
          onUploadFile={uploadAiImage}
          onNewSession={newSession}
          isConnected={isConnected}
          authError={authError}
          mode={mode}
          sessions={sessions}
          currentSessionId={currentSessionId}
          onLoadSession={loadSession}
          onFetchSessions={getSessions}
          onSetSessionName={setSessionName}
        />
      </div>
    </div>
  );
}
