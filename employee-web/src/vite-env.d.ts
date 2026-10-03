/// <reference types="vite/client" />

declare module "lucide-react" {
  import type { ComponentType, SVGProps } from "react";
  export interface LucideProps extends SVGProps<SVGSVGElement> {
    size?: number | string;
    color?: string;
    strokeWidth?: number | string;
    className?: string;
  }
  export type LucideIcon = ComponentType<LucideProps>;
  const icon: LucideIcon;
  export default icon;
  export const ArrowLeft: LucideIcon;
  export const ArrowRight: LucideIcon;
  export const BadgeCheck: LucideIcon;
  export const Bell: LucideIcon;
  export const CalendarClock: LucideIcon;
  export const Check: LucideIcon;
  export const ChevronDown: LucideIcon;
  export const ChevronLeft: LucideIcon;
  export const ChevronRight: LucideIcon;
  export const CircleAlert: LucideIcon;
  export const CircleCheck: LucideIcon;
  export const Clock: LucideIcon;
  export const CloudOff: LucideIcon;
  export const Copy: LucideIcon;
  export const Delete: LucideIcon;
  export const Eye: LucideIcon;
  export const EyeOff: LucideIcon;
  export const Flame: LucideIcon;
  export const Headphones: LucideIcon;
  export const House: LucideIcon;
  export const Info: LucideIcon;
  export const ListChecks: LucideIcon;
  export const Lock: LucideIcon;
  export const LogOut: LucideIcon;
  export const Mail: LucideIcon;
  export const MapPin: LucideIcon;
  export const MicOff: LucideIcon;
  export const Minus: LucideIcon;
  export const Phone: LucideIcon;
  export const PhoneCall: LucideIcon;
  export const PhoneForwarded: LucideIcon;
  export const PhoneIncoming: LucideIcon;
  export const PhoneMissed: LucideIcon;
  export const PhoneOff: LucideIcon;
  export const PhoneOutgoing: LucideIcon;
  export const Play: LucideIcon;
  export const RefreshCw: LucideIcon;
  export const RotateCcw: LucideIcon;
  export const Search: LucideIcon;
  export const Shield: LucideIcon;
  export const Smartphone: LucideIcon;
  export const Sparkles: LucideIcon;
  export const StickyNote: LucideIcon;
  export const Tag: LucideIcon;
  export const Target: LucideIcon;
  export const ThumbsDown: LucideIcon;
  export const ThumbsUp: LucideIcon;
  export const TrendingUp: LucideIcon;
  export const User: LucideIcon;
  export const Users: LucideIcon;
  export const WifiOff: LucideIcon;
  export const X: LucideIcon;
}
