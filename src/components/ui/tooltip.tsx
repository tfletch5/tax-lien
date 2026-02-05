"use client";

import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";

interface TooltipProps {
  content: string;
  children?: React.ReactNode;
  className?: string;
  position?: "top" | "bottom" | "left" | "right";
}

export function Tooltip({ 
  content, 
  children, 
  className = "",
  position = "top"
}: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [tooltipStyle, setTooltipStyle] = useState<React.CSSProperties>({});
  const triggerRef = useRef<HTMLDivElement>(null);

  const positionClasses = {
    top: "bottom-full left-1/2 transform -translate-x-1/2 mb-2",
    bottom: "top-full left-1/2 transform -translate-x-1/2 mt-2",
    left: "right-full top-1/2 transform -translate-y-1/2 mr-2",
    right: "left-full top-1/2 transform -translate-y-1/2 ml-2",
  };

  const arrowClasses = {
    top: "absolute top-full left-1/2 transform -translate-x-1/2 -mt-1 border-4 border-transparent border-t-gray-900",
    bottom: "absolute bottom-full left-1/2 transform -translate-x-1/2 -mb-1 border-4 border-transparent border-b-gray-900",
    left: "absolute left-full top-1/2 transform -translate-y-1/2 -ml-1 border-4 border-transparent border-l-gray-900",
    right: "absolute right-full top-1/2 transform -translate-y-1/2 -mr-1 border-4 border-transparent border-r-gray-900",
  };

  useEffect(() => {
    if (isVisible && triggerRef.current) {
      const updatePosition = () => {
        if (triggerRef.current) {
          const rect = triggerRef.current.getBoundingClientRect();
          const scrollX = window.scrollX || window.pageXOffset;
          const scrollY = window.scrollY || window.pageYOffset;
          
          const offset = 8; // Consistent offset for all positions
          let top: number | undefined;
          let bottom: number | undefined;
          let left: number;
          let right: number | undefined;
          
          // Calculate horizontal position (centered for top/bottom, aligned for left/right)
          if (position === "top" || position === "bottom") {
            left = rect.left + rect.width / 2;
            right = undefined;
          } else if (position === "left") {
            left = rect.left + scrollX;
            right = undefined;
          } else { // position === "right"
            left = rect.right + scrollX + offset;
            right = undefined;
          }
          
          // Calculate vertical position based on tooltip position
          if (position === "top") {
            // Position above the trigger element
            top = rect.top + scrollY - offset;
            bottom = undefined;
          } else if (position === "bottom") {
            // Position below the trigger element using bottom property
            bottom = window.innerHeight - (rect.bottom + scrollY) + offset;
            top = undefined;
          } else if (position === "left") {
            // Position to the left, vertically centered
            top = rect.top + scrollY + rect.height / 2;
            bottom = undefined;
          } else { // position === "right"
            // Position to the right, vertically centered
            top = rect.top + scrollY + rect.height / 2;
            bottom = undefined;
          }
          
          // Build style object with only defined values
          const style: React.CSSProperties = {
            position: 'fixed',
            left: `${left}px`,
            zIndex: 9999,
            width: '300px',
            maxWidth: '90vw',
            minWidth: '300px',
            whiteSpace: 'normal',
            wordSpacing: 'normal',
            lineHeight: '1.5'
          };
          
          if (top !== undefined) {
            style.top = `${top}px`;
          }
          if (bottom !== undefined) {
            style.bottom = `${bottom}px`;
          }
          if (right !== undefined) {
            style.right = `${right}px`;
          }
          
          // Add transform based on position
          if (position === "top" || position === "bottom") {
            style.transform = 'translateX(-50%)';
          } else if (position === "left" || position === "right") {
            style.transform = 'translateY(-50%)';
          }
          
          setTooltipStyle(style);
        }
      };
      
      updatePosition();
      window.addEventListener('scroll', updatePosition, true);
      window.addEventListener('resize', updatePosition);
      
      return () => {
        window.removeEventListener('scroll', updatePosition, true);
        window.removeEventListener('resize', updatePosition);
      };
    }
  }, [isVisible, position]);

  const tooltipContent = isVisible ? (
    <div 
      className="relative px-4 py-2.5 bg-gray-900 text-gray-50 text-sm rounded-lg shadow-2xl"
      style={tooltipStyle}
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
    >
      <div style={{ 
        wordBreak: 'normal', 
        overflowWrap: 'anywhere',
        hyphens: 'none',
        margin: 0,
        padding: 0
      }}>{content}</div>
      <div className={arrowClasses[position]}></div>
    </div>
  ) : null;

  return (
    <>
      <div
        ref={triggerRef}
        className={`relative inline-flex items-center ${className}`}
        onMouseEnter={() => setIsVisible(true)}
        onMouseLeave={() => setIsVisible(false)}
      >
        {children || <Info className="h-4 w-4 text-gray-400 hover:text-gray-600 cursor-help" />}
      </div>
      {typeof window !== 'undefined' && isVisible && createPortal(tooltipContent, document.body)}
    </>
  );
}
