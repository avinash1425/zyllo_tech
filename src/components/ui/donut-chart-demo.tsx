"use client";

import React, { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { DonutChart } from "@/components/ui/donut-chart";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const financialData = [
  { value: 184, color: "hsl(214.7 95% 40%)", label: "Financial Objections" },
  { value: 50, color: "hsl(142.1 76.2% 36.3%)", label: "Product Features" },
  { value: 30, color: "hsl(47.9 95.8% 53.1%)", label: "Timing Issues" },
  { value: 20, color: "hsl(0 0% 63.9%)", label: "Competitor Offers" },
  { value: 10, color: "hsl(262.1 83.3% 57.8%)", label: "Other Reasons" },
];

const totalFinancialValue = financialData.reduce((sum, d) => sum + d.value, 0);

export default function DonutChartDemo() {
  const [hoveredSegment, setHoveredSegment] = useState<string | null>(null);

  const activeSegment = financialData.find(
    (segment) => segment.label === hoveredSegment
  );

  const displayValue = activeSegment?.value ?? totalFinancialValue;
  const displayLabel = activeSegment?.label ?? "Total Objections";
  const displayPercentage =
    activeSegment ? (activeSegment.value / totalFinancialValue) * 100 : 100;

  return (
    <Card className="mx-auto flex w-full max-w-md flex-col items-center justify-center space-y-6 rounded-xl bg-background p-6 text-foreground shadow-lg md:p-8">
      <h2 className="text-xl font-semibold tracking-tight text-foreground">
        Objection Breakdown
      </h2>

      <div className="relative flex items-center justify-center">
        <DonutChart
          data={financialData}
          size={250}
          strokeWidth={30}
          animationDuration={1.2}
          animationDelayPerSegment={0.05}
          highlightOnHover
          onSegmentHover={(segment) => setHoveredSegment(segment?.label ?? null)}
          centerContent={
            <AnimatePresence mode="wait">
              <motion.div
                key={displayLabel}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.2, ease: "circOut" }}
                className="flex flex-col items-center justify-center text-center"
              >
                <p className="max-w-[150px] truncate text-sm font-medium text-muted-foreground">
                  {displayLabel}
                </p>
                <p className="text-4xl font-bold text-foreground">{displayValue}</p>
                {activeSegment && (
                  <p className="text-lg font-medium text-muted-foreground">
                    [{displayPercentage.toFixed(0)}%]
                  </p>
                )}
              </motion.div>
            </AnimatePresence>
          }
        />
      </div>

      <div className="w-full space-y-2 border-t border-border pt-4">
        {financialData.map((segment, index) => (
          <motion.div
            key={segment.label}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 1.2 + index * 0.1, duration: 0.4 }}
            className={cn(
              "flex cursor-pointer items-center justify-between rounded-md p-2 transition-all duration-200",
              hoveredSegment === segment.label && "bg-muted"
            )}
            onMouseEnter={() => setHoveredSegment(segment.label)}
            onMouseLeave={() => setHoveredSegment(null)}
          >
            <div className="flex items-center space-x-3">
              <span
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: segment.color }}
              />
              <span className="text-sm font-medium text-foreground">
                {segment.label}
              </span>
            </div>
            <span className="text-sm font-semibold text-muted-foreground">
              {segment.value}
            </span>
          </motion.div>
        ))}
      </div>
    </Card>
  );
}
