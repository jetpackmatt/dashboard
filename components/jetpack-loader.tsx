"use client"

import { cn } from "@/lib/utils"

interface JetpackLoaderProps {
  className?: string
  size?: "sm" | "md" | "lg"
}

export function JetpackLoader({ className, size = "md" }: JetpackLoaderProps) {
  const sizeClasses = {
    sm: "w-4 h-3",
    md: "w-5 h-4",
    lg: "w-8 h-6",
  }

  return (
    <div className={cn("relative inline-flex items-center", className)}>
      <svg
        viewBox="0 0 38.66 27.72"
        className={cn(sizeClasses[size])}
        aria-label="Loading"
      >
        {/* Orange rectangle - main body */}
        <rect
          className="animate-jetpack-body"
          x="9.77"
          y="7.14"
          width="20.84"
          height="20.58"
          transform="translate(40.38 34.85) rotate(180)"
          fill="#eb9458"
        />
        {/* Blue polygon - top wing */}
        <polygon
          className="animate-jetpack-wing"
          points="30.61 5.91 9.77 5.91 17.82 0 38.66 0 30.61 5.91"
          fill="#338bca"
        />
        {/* Yellow polyline - left flame/accent */}
        <polyline
          className="animate-jetpack-flame"
          points="8.37 7.72 8.37 27.72 0 27.72"
          fill="#fec15f"
        />
      </svg>
      <style jsx>{`
        @keyframes jetpack-body {
          0%, 100% { opacity: 0.4; }
          33% { opacity: 1; }
        }
        @keyframes jetpack-wing {
          0%, 100% { opacity: 0.4; }
          66% { opacity: 1; }
        }
        @keyframes jetpack-flame {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        .animate-jetpack-body {
          animation: jetpack-body 1.2s ease-in-out infinite;
        }
        .animate-jetpack-wing {
          animation: jetpack-wing 1.2s ease-in-out infinite;
        }
        .animate-jetpack-flame {
          animation: jetpack-flame 0.6s ease-in-out infinite;
        }
      `}</style>
    </div>
  )
}
