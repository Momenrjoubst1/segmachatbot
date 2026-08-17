'use client';

import { Link } from 'react-router-dom';
import { motion, AnimatePresence, type Variants } from 'framer-motion';
import { FlowButton } from "@/components/ui/flow-button";

function GhostSvg({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <ellipse cx="60" cy="95" rx="35" ry="8" fill="#e0e0e0" opacity="0.3" />
      <path
        d="M30 65C30 38 42 20 60 20C78 20 90 38 90 65V90C90 90 85 82 80 90C75 82 70 90 65 82C60 90 55 82 50 90C45 82 40 90 35 82C30 90 30 90 30 90V65Z"
        fill="white"
        stroke="#e0e0e0"
        strokeWidth="1.5"
      />
      <ellipse cx="48" cy="55" rx="6" ry="7" fill="#333" />
      <ellipse cx="72" cy="55" rx="6" ry="7" fill="#333" />
      <ellipse cx="46" cy="53" rx="2.5" ry="3" fill="white" />
      <ellipse cx="70" cy="53" rx="2.5" ry="3" fill="white" />
      <ellipse cx="60" cy="72" rx="4" ry="5" fill="#ffb6c1" opacity="0.5" />
    </svg>
  );
}

const ease = [0.43, 0.13, 0.23, 0.96] as [number, number, number, number];

const containerVariants: Variants = {
  hidden: {
    opacity: 0,
    y: 30
  },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.7,
      ease,
      delayChildren: 0.1,
      staggerChildren: 0.1
    }
  }
};

const itemVariants: Variants = {
  hidden: {
    opacity: 0,
    y: 20
  },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.6,
      ease
    }
  }
};

const numberVariants: Variants = {
  hidden: (direction: number) => ({
    opacity: 0,
    x: direction * 40,
    y: 15,
    rotate: direction * 5
  }),
  visible: {
    opacity: 0.7,
    x: 0,
    y: 0,
    rotate: 0,
    transition: {
      duration: 0.8,
      ease
    }
  }
};

const ghostVariants: Variants = {
  hidden: {
    scale: 0.8,
    opacity: 0,
    y: 15,
    rotate: -5
  },
  visible: {
    scale: 1,
    opacity: 1,
    y: 0,
    rotate: 0,
    transition: {
      duration: 0.6,
      ease
    }
  },
  hover: {
    scale: 1.1,
    y: -10,
    rotate: [0, -5, 5, -5, 0],
    transition: {
      duration: 0.8,
      ease: "easeInOut",
      rotate: {
        duration: 2,
        ease: "linear",
        repeat: Infinity,
        repeatType: "reverse" as const
      }
    }
  },
  floating: {
    y: [-5, 5],
    transition: {
      y: {
        duration: 2,
        ease: "easeInOut",
        repeat: Infinity,
        repeatType: "reverse" as const
      }
    }
  }
};

export function NotFound() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-white px-4 py-8 overflow-auto">
      <AnimatePresence mode="wait">
        <motion.div
          className="text-center"
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          exit="hidden"
        >
          <div className="flex items-center justify-center gap-4 md:gap-6 mb-8 md:mb-12">
            <motion.span
              className="text-[80px] md:text-[120px] font-bold text-[#222222] opacity-70 select-none"
              variants={numberVariants}
              custom={-1}
            >
              4
            </motion.span>
            <motion.div
              variants={ghostVariants}
              whileHover="hover"
              animate={["visible", "floating"]}
            >
              <GhostSvg className="w-[80px] h-[80px] md:w-[120px] md:h-[120px] select-none" />
            </motion.div>
            <motion.span
              className="text-[80px] md:text-[120px] font-bold text-[#222222] opacity-70 select-none"
              variants={numberVariants}
              custom={1}
            >
              4
            </motion.span>
          </div>

          <motion.h1
            className="text-3xl md:text-5xl font-bold text-[#222222] mb-4 md:mb-6 opacity-70 select-none"
            variants={itemVariants}
          >
            Boo! Page missing!
          </motion.h1>

          <motion.p
            className="text-lg md:text-xl text-[#222222] mb-8 md:mb-12 opacity-50 select-none"
            variants={itemVariants}
          >
            Whoops! This page must be a ghost - it&apos;s not here!
          </motion.p>

          <motion.div
            variants={itemVariants}
            whileHover={{
              scale: 1.05,
              transition: {
                duration: 0.3,
                ease: [0.43, 0.13, 0.23, 0.96]
              }
            }}
            className="flex justify-center"
          >
            <Link to="/">
              <FlowButton text="Find shelter" />
            </Link>
          </motion.div>

          <motion.div
            className="mt-12"
            variants={itemVariants}
          >
            <Link
              to="/"
              className="text-[#222222] opacity-50 hover:opacity-70 transition-opacity underline select-none"
            >
              What means 404?
            </Link>
          </motion.div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
