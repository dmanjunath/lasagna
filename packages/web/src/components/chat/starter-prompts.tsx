import { useState } from "react";
import { Send } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "../ui/button.js";
import type { PlanType } from "../../lib/types.js";

const promptsByType: Record<PlanType, string[]> = {
  retirement: [
    "Analyze my retirement readiness",
    "I want to retire early, am I on track?",
    "Stress test my retirement plan",
  ],
  net_worth: [
    "Show my net worth breakdown",
    "How has my wealth changed?",
    "Review my asset allocation",
  ],
  debt_payoff: [
    "Create a debt payoff strategy",
    "What's the most efficient way to pay off my debt",
    "How fast can I become debt-free?",
  ],
  custom: [
    "Help me create a financial plan",
    "What should I focus on first to maximize my future net worth?",
    "Analyze my financial health",
  ],
};

type StarterPromptsProps = {
  planType: PlanType;
  onSelectPrompt: (prompt: string) => void;
};

export function StarterPrompts({ planType, onSelectPrompt }: StarterPromptsProps) {
  const [customPrompt, setCustomPrompt] = useState("");
  const prompts = promptsByType[planType] || promptsByType.custom;

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (customPrompt.trim()) {
      onSelectPrompt(customPrompt.trim());
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h3 className="text-lg font-medium text-text mb-2">Get started with a question</h3>
        <p className="text-sm text-text-muted">Choose a suggestion or write your own</p>
      </div>

      <div className="grid gap-3">
        {prompts.map((prompt, index) => (
          <motion.button
            key={index}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
            onClick={() => onSelectPrompt(prompt)}
            className="w-full p-4 text-left rounded-xl border border-border bg-surface hover:border-accent/50 hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 transition-all text-sm text-text"
          >
            {prompt}
          </motion.button>
        ))}
      </div>

      <form onSubmit={handleCustomSubmit} className="flex gap-2">
        <input
          value={customPrompt}
          onChange={(e) => setCustomPrompt(e.target.value)}
          placeholder="Or type your own question..."
          className="flex-1 px-4 py-3 bg-surface rounded-xl border border-border text-text placeholder:text-text-muted focus:outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/20"
        />
        <Button type="submit" disabled={!customPrompt.trim()}>
          <Send className="w-4 h-4" />
        </Button>
      </form>
    </div>
  );
}
