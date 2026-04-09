import { motion } from "framer-motion";
import { useLocation } from "wouter";
import { useAuth } from "../lib/auth";

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.07 },
  },
};

const item = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0 },
};

interface SettingsRowProps {
  icon: string;
  label: string;
  danger?: boolean;
  onClick?: () => void;
}

function SettingsRow({ icon, label, danger, onClick }: SettingsRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between px-5 py-4 cursor-pointer hover:bg-surface-hover transition-colors text-left"
    >
      <div className="flex items-center gap-3.5">
        <div className="w-9 h-9 rounded-lg bg-bg-elevated flex items-center justify-center text-lg">
          {icon}
        </div>
        <span className={danger ? "text-danger font-medium" : "text-text"}>
          {label}
        </span>
      </div>
      <span className="text-sm text-text-muted">›</span>
    </button>
  );
}

interface StatRowProps {
  label: string;
  value: string;
  valueClass?: string;
}

function StatRow({ label, value, valueClass }: StatRowProps) {
  return (
    <div className="flex items-center justify-between px-5 py-3.5">
      <span className="text-sm text-text-muted">{label}</span>
      <span className={`text-sm font-medium ${valueClass || "text-text"}`}>
        {value}
      </span>
    </div>
  );
}

export function Settings() {
  const { user, tenant, logout } = useAuth();
  const [, navigate] = useLocation();

  const initial = (tenant?.name || user?.email || "U").charAt(0).toUpperCase();
  const displayName = tenant?.name || "User";
  const email = user?.email || "";

  const grossIncome = "$72,000/yr";

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin p-4 md:p-6 lg:p-8">
      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="max-w-lg mx-auto space-y-6 pb-8"
      >
        {/* Profile Header */}
        <motion.div variants={item} className="flex flex-col items-center pt-4 pb-2">
          <div className="w-[72px] h-[72px] rounded-full bg-bg-elevated border border-border flex items-center justify-center mb-3">
            <span className="text-2xl font-bold text-text">{initial}</span>
          </div>
          <h1 className="font-display text-2xl font-semibold text-text">
            {displayName}
          </h1>
          <p className="text-sm text-text-muted">{email}</p>
        </motion.div>

        {/* Navigation Card */}
        <motion.div
          variants={item}
          className="glass-card rounded-2xl p-0 overflow-hidden divide-y divide-border"
        >
          <SettingsRow icon="👤" label="Personal Info" />
          <SettingsRow icon="💼" label="Income & Employment" />
          <SettingsRow
            icon="🏦"
            label="Linked Accounts"
            onClick={() => navigate("/accounts")}
          />
          <SettingsRow icon="🎯" label="Financial Goals" />
        </motion.div>

        {/* Your Profile Stats */}
        <motion.div variants={item}>
          <h2 className="text-sm font-semibold text-text-muted uppercase tracking-wider px-1 mb-2">
            Your Profile
          </h2>
          <div className="glass-card rounded-2xl p-0 overflow-hidden divide-y divide-border">
            <StatRow label="Age" value="28" />
            <StatRow label="Gross income" value={grossIncome} />
            <StatRow label="Filing status" value="Single" />
            <StatRow label="State" value="California" />
            <StatRow
              label="Risk tolerance"
              value="Moderate-aggressive"
              valueClass="text-green-400"
            />
          </div>
        </motion.div>

        {/* Settings Card */}
        <motion.div
          variants={item}
          className="glass-card rounded-2xl p-0 overflow-hidden divide-y divide-border"
        >
          <SettingsRow icon="🔔" label="Notifications" />
          <SettingsRow icon="🔒" label="Privacy & Security" />
          <SettingsRow icon="❓" label="Help & Support" />
          <SettingsRow
            icon="🚪"
            label="Sign Out"
            danger
            onClick={() => logout()}
          />
        </motion.div>

        {/* Footer */}
        <motion.p
          variants={item}
          className="text-xs text-text-muted text-center pt-2"
        >
          Lasagna v0.1.0 · Built in the open
        </motion.p>
      </motion.div>
    </div>
  );
}
