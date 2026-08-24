import * as React from "react"
import { useRef, useState, useEffect } from "react";
import {
  MotionValue,
  motion,
  useMotionValue,
  useSpring,
  useTransform,
} from "framer-motion";

import { Link } from "react-router-dom";
import { cn } from "@/lib/cn";
 
export interface AnimatedDockProps {
  className?: string;
  items: DockItemData[];
}
 
export interface DockItemData {
  link?: string;
  onClick?: () => void;
  Icon: React.ReactNode;
  target?: string;
  title?: string;
  arrowPath?: string;
}
 
export const AnimatedDock = ({ className, items }: AnimatedDockProps) => {
  const mouseX = useMotionValue(Infinity);
 
  return (
    <motion.div
      onMouseMove={(e) => mouseX.set(e.pageX)}
      onMouseLeave={() => mouseX.set(Infinity)}
      className={cn(
        "mx-auto flex h-16 items-end gap-4 rounded-2xl bg-secondary/50 border border-primary/10 shadow-md px-4 pb-3 overflow-visible",
        className,
      )}
    >
      {items.map((item, index) => {
        const isExternal = item.link && (item.link.startsWith("http://") || item.link.startsWith("https://") || item.link.startsWith("//"));
        const content = item.onClick ? (
          <button
            onClick={item.onClick}
            className="flex items-center justify-center text-foreground bg-transparent border-0 cursor-pointer focus:outline-none"
          >
            {item.Icon}
          </button>
        ) : isExternal ? (
          <a
            href={item.link}
            target={item.target}
            className="flex items-center justify-center w-full h-full"
          >
            {item.Icon}
          </a>
        ) : item.link ? (
          <Link
            to={item.link}
            target={item.target}
            className="flex items-center justify-center w-full h-full"
          >
            {item.Icon}
          </Link>
        ) : (
          <div className="flex items-center justify-center w-full h-full">
            {item.Icon}
          </div>
        );

        return (
          <DockItem key={index} mouseX={mouseX} tooltip={item.title} arrowPath={item.arrowPath}>
            {content}
          </DockItem>
        );
      })}
    </motion.div>
  );
};
 
interface DockItemProps {
  mouseX: MotionValue<number>;
  children: React.ReactNode;
  tooltip?: string;
  arrowPath?: string;
}
 
export const DockItem = ({ mouseX, children, tooltip, arrowPath }: DockItemProps) => {
  const ref = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const [showLabel, setShowLabel] = useState(false);
  const [animate, setAnimate] = useState(false);
  const pathRef = useRef<SVGPathElement>(null);
  const [pathLength, setPathLength] = useState(100);

  const distance = useTransform(mouseX, (val) => {
    const bounds = ref.current?.getBoundingClientRect() ?? { x: 0, width: 0 };
    return val - bounds.x - bounds.width / 2;
  });

  const widthSync = useTransform(distance, [-150, 0, 150], [40, 80, 40]);
  const width = useSpring(widthSync, {
    mass: 0.1,
    stiffness: 150,
    damping: 12,
  });

  const iconScale = useTransform(width, [40, 80], [1, 1.5]);
  const iconSpring = useSpring(iconScale, {
    mass: 0.1,
    stiffness: 150,
    damping: 12,
  });

  useEffect(() => {
    if (hovered) {
      setShowLabel(false);
      setAnimate(false);
      requestAnimationFrame(() => {
        setAnimate(true);
      });
      const timer = setTimeout(() => setShowLabel(true), 500);
      return () => clearTimeout(timer);
    } else {
      setShowLabel(false);
      setAnimate(false);
    }
  }, [hovered]);

  useEffect(() => {
    if (pathRef.current) {
      setPathLength(pathRef.current.getTotalLength());
    }
  }, [hovered, arrowPath]);

  return (
    <motion.div
      ref={ref}
      style={{ width }}
      className="aspect-square w-10 rounded-full bg-transparent text-foreground flex items-center justify-center relative overflow-visible"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <motion.div
        style={{ scale: iconSpring }}
        className="flex items-center justify-center w-full h-full"
      >
        {children}
      </motion.div>
      {tooltip && hovered && (
        <div
          style={{
            position: 'absolute',
            top: '60%',
            left: '50%',
            transform: 'translate(-50%, 0)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            zIndex: 99999,
            pointerEvents: 'none',
          }}
        >
          <svg width="24" height="32" viewBox="0 0 24 32" fill="none" style={{ marginBottom: '-2px' }}>
            <path
              ref={pathRef}
              d={arrowPath || "M12 0 C12 0, 8 4, 12 8 C16 12, 20 8, 16 14 C12 20, 8 16, 12 22 L10 26 L12 30 L14 26 L12 22"}
              stroke="#111827"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
              style={{
                strokeDasharray: pathLength,
                strokeDashoffset: animate ? 0 : pathLength,
                transition: 'stroke-dashoffset 0.5s ease-in-out',
              }}
            />
          </svg>
          {showLabel && (
            <div
              style={{
                fontSize: '10px',
                fontWeight: 500,
                padding: '2px 8px',
                borderRadius: '9999px',
                backgroundColor: '#111827',
                color: '#ffffff',
                border: '1px solid rgba(255,255,255,0.3)',
                whiteSpace: 'nowrap',
                animation: 'fadeIn 0.3s ease-in',
              }}
            >
              {tooltip}
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
};
