import { useEffect, useState } from "react";
import { useParams } from "wouter";
import { MessageSquare, History, MoreVertical } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "../../lib/api.js";
import { UIRenderer } from "../../components/ui-renderer/index.js";
import { ChatPanel } from "../../components/chat/index.js";
import { Button } from "../../components/ui/button.js";
import type { Plan, ChatThread, Message } from "../../lib/types.js";

export function PlanDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [thread, setThread] = useState<ChatThread | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [showChat, setShowChat] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;

    Promise.all([
      api.getPlan(id),
      api.getThreads(id),
    ]).then(([planData, { threads }]) => {
      setPlan(planData);

      if (threads.length > 0) {
        setThread(threads[0]);
        api.getThread(threads[0].id).then(({ messages }) => {
          setMessages(messages);
        });
      }

      setLoading(false);
    });
  }, [id]);

  if (loading) {
    return (
      <div className="p-6 text-text-muted">Loading plan...</div>
    );
  }

  if (!plan) {
    return (
      <div className="p-6 text-text-muted">Plan not found</div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-4rem)]">
      {/* Main content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="flex items-start justify-between mb-8">
            <div>
              <h1 className="text-2xl font-display font-semibold text-text">
                {plan.title}
              </h1>
              <p className="text-text-muted mt-1 capitalize">
                {plan.type.replace("_", " ")} Plan
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowChat(!showChat)}
              >
                <MessageSquare className="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="sm">
                <History className="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="sm">
                <MoreVertical className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Plan content */}
          {plan.content ? (
            <UIRenderer payload={plan.content} />
          ) : (
            <div className="glass-card p-8 text-center">
              <p className="text-text-muted mb-4">
                This plan is empty. Start a conversation to generate content.
              </p>
              {!showChat && (
                <Button onClick={() => setShowChat(true)}>
                  <MessageSquare className="w-4 h-4 mr-2" />
                  Open Chat
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Chat panel */}
      <AnimatePresence>
        {showChat && thread && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 400, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            className="border-l border-border overflow-hidden"
          >
            <ChatPanel threadId={thread.id} initialMessages={messages} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
