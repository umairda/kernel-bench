import { motion } from 'framer-motion'

type SpotlightProps = {
  className?: string
  fill?: string
}

export function Spotlight({ className = '', fill = 'rgba(56,189,248,0.26)' }: SpotlightProps) {
  return (
    <motion.div
      initial={{ opacity: 0.35, scale: 0.95 }}
      animate={{ opacity: 0.7, scale: 1 }}
      transition={{ duration: 2.6, ease: 'easeOut' }}
      className={`pointer-events-none absolute inset-0 ${className}`}
    >
      <svg className="h-full w-full" viewBox="0 0 1200 600" fill="none" xmlns="http://www.w3.org/2000/svg">
        <g filter="url(#blur)">
          <ellipse cx="600" cy="110" rx="340" ry="170" fill={fill} />
        </g>
        <defs>
          <filter id="blur" x="0" y="-300" width="1200" height="900" filterUnits="userSpaceOnUse">
            <feGaussianBlur stdDeviation="72" />
          </filter>
        </defs>
      </svg>
    </motion.div>
  )
}
