import { useEffect, useState, useCallback } from "react";
import { useParams } from "wouter";
import { History, MoreVertical, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "../../lib/api.js";
import { UIRenderer } from "../../components/ui-renderer/index.js";
import { ChatPanel, StarterPrompts } from "../../components/chat/index.js";
import { Button } from "../../components/ui/button.js";
import type { Plan, ChatThread, Message } from "../../lib/types.js";

export function PlanDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [thread, setThread] = useState<ChatThread | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [initialMessage, setInitialMessage] = useState<string | null>(null);
  const [generatingContent, setGeneratingContent] = useState(false);

  // Only show chat sidebar if there are messages or we're sending one
  const hasChat = messages.length > 0 || initialMessage !== null;

  const handleSelectPrompt = async (prompt: string) => {
    // Create thread if one doesn't exist
    if (!thread && id) {
      const { thread: newThread } = await api.createThread(id);
      setThread(newThread);
    }
    setInitialMessage(prompt);
    setGeneratingContent(true);
  };

  // Refresh plan content after chat response
  const handleChatResponse = useCallback(async () => {
    if (!id) return;
    try {
      const updatedPlan = await api.getPlan(id);
      setPlan(updatedPlan);
    } finally {
      setGeneratingContent(false);
    }
  }, [id]);

  useEffect(() => {
    if (!id) return;

    // Reset all state when plan changes
    setLoading(true);
    setPlan(null);
    setThread(null);
    setMessages([]);
    setInitialMessage(null);
    setGeneratingContent(false);

    const loadPlan = async () => {
      const [planData, { threads }] = await Promise.all([
        api.getPlan(id),
        api.getThreads(id),
      ]);

      setPlan(planData);

      if (threads.length > 0) {
        setThread(threads[0]);
        const { messages: threadMessages } = await api.getThread(threads[0].id);
        setMessages(threadMessages);
      }

      setLoading(false);
    };

    loadPlan();
  }, [id]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="flex items-center gap-3 text-text-muted">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>Loading plan...</span>
        </div>
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 text-text-muted">
        Plan not found
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Main content */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="flex items-start justify-between mb-8">
            <div>
              <h1 className="text-2xl md:text-3xl lg:text-4xl font-display font-semibold text-text">
                {plan.title}
              </h1>
              <p className="text-text-muted mt-1 capitalize">
                {plan.type.replace("_", " ")} Plan
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm">
                <History className="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="sm">
                <MoreVertical className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Plan content */}
          {generatingContent ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="glass-card p-12 flex flex-col items-center justify-center gap-4"
            >
              <Loader2 className="w-8 h-8 text-accent animate-spin" />
              <p className="text-text-muted">Generating your plan...</p>
            </motion.div>
          ) : plan.content ? (
            <UIRenderer payload={plan.content} />
          ) : (
            <div className="glass-card p-8">
              {messages.length === 0 && !initialMessage ? (
                <StarterPrompts
                  planType={plan.type}
                  onSelectPrompt={handleSelectPrompt}
                />
              ) : (
                <p className="text-text-muted text-center py-8">
                  Start a conversation to generate content.
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Chat panel - only show when there are messages or sending one */}
      <AnimatePresence>
        {hasChat && thread && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 380, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="border-l border-border overflow-hidden h-full flex-shrink-0"
          >
            <ChatPanel
              threadId={thread.id}
              initialMessages={messages}
              initialMessage={initialMessage}
              onMessageSent={() => setInitialMessage(null)}
              onChatResponse={handleChatResponse}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
