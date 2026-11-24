import { useId } from "react";

// ExamAI's own agent icons: one robot head, with a badge for each agent's
// job. Same props as lucide icons (size, className, style, strokeWidth) so
// they drop in anywhere a lucide icon goes. Kept in step with
// admin-panel/src/components/AgentIcons.jsx.

const BADGES = {
  // four-point spark
  copilot: <path d="M19 13.6l1.2 3.2 3.2 1.2-3.2 1.2-1.2 3.2-1.2-3.2-3.2-1.2 3.2-1.2z" fill="currentColor" stroke="none" />,
  // tick
  grading: <path d="M15.6 18.4l2.3 2.3 4.2-4.6" />,
  // mortarboard
  afterClass: <><path d="M14.6 17l4.4-2.2 4.4 2.2-4.4 2.2z" /><path d="M16.4 18.1v2.1c1.6 1.1 3.6 1.1 5.2 0v-2.1" /></>,
  // pulse line
  atRisk: <path d="M14.4 18.6h2l1.3-2.9 2.2 5.4 1.3-2.5h1.6" />,
  // megaphone
  marketing: <><path d="M15 17.2v2.4l1.6.2 5.6 2v-6.8l-5.6 2z" /><path d="M16.6 19.8l.6 2.2" /></>,
  // speech bubble
  support: <path d="M15 15.4h8v4.6h-4.4l-2.4 2v-2H15z" />,
  // open book
  tutor: <><path d="M19 16.2c-1.2-.9-2.7-1.2-4.2-1.1v5.8c1.5-.1 3 .2 4.2 1.1 1.2-.9 2.7-1.2 4.2-1.1v-5.8c-1.5-.1-3 .2-4.2 1.1z" /><path d="M19 16.2v5.8" /></>,
};

function AgentIcon({ badge, size = 24, strokeWidth = 2, className, style, title, ...rest }) {
  const mask = `agm${useId().replace(/:/g, "")}`;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      className={className} style={style} aria-hidden={title ? undefined : true} role={title ? "img" : undefined} {...rest}
    >
      {title && <title>{title}</title>}
      {badge && (
        <mask id={mask}>
          <rect width="24" height="24" fill="#fff" />
          <circle cx="19" cy="18.4" r="6" fill="#000" />
        </mask>
      )}
      <g mask={badge ? `url(#${mask})` : undefined}>
        {/* antenna */}
        <path d="M10 6.5V3.8" />
        <circle cx="10" cy="2.8" r="1" fill="currentColor" stroke="none" />
        {/* head, ears */}
        <rect x="3" y="6.5" width="14" height="12" rx="3.5" />
        <path d="M1 11.5v3M19 11.5v3" />
        {/* eyes, mouth */}
        <circle cx="7.4" cy="11.6" r="1.25" fill="currentColor" stroke="none" />
        <circle cx="12.6" cy="11.6" r="1.25" fill="currentColor" stroke="none" />
        <path d="M8 15.2h4" />
      </g>
      {badge && BADGES[badge]}
    </svg>
  );
}

const make = (badge, name) => {
  const C = (props) => <AgentIcon badge={badge} {...props} />;
  C.displayName = name;
  return C;
};

export const AgentsGlyph = make(null, "AgentsGlyph");
export const CopilotIcon = make("copilot", "CopilotIcon");
export const GradingAgentIcon = make("grading", "GradingAgentIcon");
export const AfterClassAgentIcon = make("afterClass", "AfterClassAgentIcon");
export const AtRiskAgentIcon = make("atRisk", "AtRiskAgentIcon");
export const SupportAgentIcon = make("support", "SupportAgentIcon");
export const MarketingAgentIcon = make("marketing", "MarketingAgentIcon");
export const TutorAgentIcon = make("tutor", "TutorAgentIcon");

// By agent key (AgentRun.agent, Settings → AI → Agents).
export const AGENT_ICONS = {
  copilot: CopilotIcon,
  grading: GradingAgentIcon,
  afterClass: AfterClassAgentIcon,
  atRisk: AtRiskAgentIcon,
  support: SupportAgentIcon,
  marketing: MarketingAgentIcon,
  tutor: TutorAgentIcon,
};
