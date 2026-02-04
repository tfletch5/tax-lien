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
          
          let top = 0;
          let left = rect.left + rect.width / 2;
          
          if (position === "bottom") {
            top = rect.bottom + scrollY + 8;
          } else {
            top = rect.top + scrollY - 8;
          }
          
          setTooltipStyle({
            position: 'fixed',
            top: position === "top" ? `${top}px` : undefined,
            bottom: position === "bottom" ? `${window.innerHeight - (rect.bottom + scrollY) + 8}px` : undefined,
            left: `${left}px`,
            transform: 'translateX(-50%)',
            width: '300px',
            maxWidth: '90vw',
            minWidth: '300px',
            zIndex: 9999,
            whiteSpace: 'normal',
            wordSpacing: 'normal',
            lineHeight: '1.5'
          });
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
