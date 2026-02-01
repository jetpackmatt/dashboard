"use client"

import { SiteHeader } from "@/components/site-header"
import { Badge } from "@/components/ui/badge"
import { Sparkles, Eye, Brain, TrendingUp, BarChart3, Clock, AlertTriangle, CheckCircle2, Radar } from "lucide-react"

export default function AboutDeliveryIQPage() {
  return (
    <>
      <SiteHeader sectionName="About Delivery IQ" />
      <div className="flex flex-1 flex-col overflow-x-hidden bg-background rounded-t-xl">
        <div className="max-w-4xl mx-auto px-6 py-12 space-y-16">

          {/* Hero */}
          <section className="text-center space-y-4">
            <Badge variant="secondary" className="mb-4">
              <Radar className="w-3 h-3 mr-1" />
              Powered by Scout
            </Badge>
            <h1 className="text-4xl font-bold tracking-tight">Delivery IQ</h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Know before your customer does.
            </p>
          </section>

          {/* The Problem */}
          <section className="space-y-4">
            <h2 className="text-2xl font-semibold">The Problem</h2>
            <p className="text-muted-foreground leading-relaxed">
              Every day, packages go missing. Customers get anxious. They email. They call. They leave bad reviews.
              And by the time you find out, it&apos;s already a crisis.
            </p>
            <p className="text-muted-foreground leading-relaxed">
              Lost packages cost e-commerce brands more than refunds. They cost trust.
            </p>
          </section>

          {/* The Solution */}
          <section className="space-y-4">
            <h2 className="text-2xl font-semibold">The Solution</h2>
            <p className="text-lg font-medium">
              Delivery IQ watches every package, so you don&apos;t have to.
            </p>
            <p className="text-muted-foreground leading-relaxed">
              We monitor your shipments in real-time, detect problems before they become complaints,
              and tell you exactly when to act—and when to wait. At its core is <strong>Scout</strong>—our
              AI-powered prediction engine that identifies at-risk shipments before a human ever could.
            </p>
          </section>

          {/* How It Works */}
          <section className="space-y-8">
            <h2 className="text-2xl font-semibold">How It Works</h2>

            <div className="grid gap-6 md:grid-cols-3">
              <div className="p-6 rounded-lg border bg-card">
                <Eye className="w-8 h-8 mb-4 text-primary" />
                <h3 className="font-semibold mb-2">1. Continuous Monitoring</h3>
                <p className="text-sm text-muted-foreground">
                  Every shipment. Every carrier scan. Every silence. Scout tracks it all,
                  automatically, 24/7. We pull data from carriers in real-time.
                </p>
              </div>

              <div className="p-6 rounded-lg border bg-card">
                <Brain className="w-8 h-8 mb-4 text-primary" />
                <h3 className="font-semibold mb-2">2. Proactive Risk Detection</h3>
                <p className="text-sm text-muted-foreground">
                  Scout analyzes each shipment&apos;s journey and assigns risk levels based on
                  silence duration, movement direction, seasonal patterns, and carrier behavior.
                </p>
              </div>

              <div className="p-6 rounded-lg border bg-card">
                <TrendingUp className="w-8 h-8 mb-4 text-primary" />
                <h3 className="font-semibold mb-2">3. Intelligent Recommendations</h3>
                <p className="text-sm text-muted-foreground">
                  Scout distinguishes between normal delays, warning signs worth monitoring,
                  and packages that are likely lost and need action.
                </p>
              </div>
            </div>
          </section>

          {/* Scout: The Delivery Intelligence Engine */}
          <section className="space-y-6 p-8 rounded-xl border-2 border-primary/20 bg-primary/5">
            <div className="flex items-center gap-3">
              <Sparkles className="w-6 h-6 text-primary" />
              <h2 className="text-2xl font-semibold">Scout: The Delivery Intelligence Engine</h2>
            </div>

            <div className="space-y-4">
              <h3 className="text-lg font-medium">Predictive Intelligence That Spots Problems First</h3>
              <p className="text-muted-foreground leading-relaxed">
                Scout is Jetpack&apos;s proprietary delivery intelligence engine—<strong>powered by AI</strong> to
                detect issues with each package proactively, before a human could identify the problem.
              </p>
              <blockquote className="border-l-4 border-primary pl-4 py-2 italic text-lg">
                &quot;What&apos;s the probability this package will be delivered?&quot;
              </blockquote>
              <p className="text-muted-foreground">
                Not a guess. Not a rule-based flag. A real probability calculated from patterns
                in thousands of similar shipments.
              </p>
            </div>
          </section>

          {/* How Scout Works */}
          <section className="space-y-6">
            <h2 className="text-2xl font-semibold">How Scout Works</h2>

            <div className="space-y-6">
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <BarChart3 className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-medium mb-1">Learns from your outcomes</h3>
                  <p className="text-sm text-muted-foreground">
                    Every delivered package and every lost package teaches Scout.
                    We extract patterns from a full year of historical data.
                  </p>
                </div>
              </div>

              <div className="flex gap-4">
                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <Clock className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-medium mb-1">Time-in-state analysis</h3>
                  <p className="text-sm text-muted-foreground">
                    Scout doesn&apos;t just look at what scan happened—it measures how long.
                    A package at a hub for 2 days? Normal. 8 days? Concerning.
                  </p>
                </div>
              </div>

              <div className="flex gap-4">
                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-medium mb-1">Risk factor modeling</h3>
                  <p className="text-sm text-muted-foreground">
                    Scout has learned which factors increase loss risk—exception scans (~40%),
                    backward movement (~50%), peak season (15-30%). These are coefficients learned from actual outcomes.
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* What Scout Tells You */}
          <section className="space-y-6">
            <h2 className="text-2xl font-semibold">What Scout Tells You</h2>

            <div className="rounded-lg border bg-card p-6 font-mono text-sm">
              <div className="text-center space-y-4">
                <div className="text-5xl font-bold text-primary">87%</div>
                <div className="text-muted-foreground">likely to deliver</div>
                <div className="text-left space-y-2 mt-6 pt-6 border-t">
                  <p>Your package is at the Chicago distribution center and has an 87% chance of delivery based on 2,400 similar USPS shipments.</p>
                  <p>It&apos;s been at this facility for 2 days, which is typical for cross-country routes in January.</p>
                  <p className="font-semibold">Expected delivery: 2-3 more days</p>
                </div>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="text-center p-4">
                <div className="font-medium mb-1">Plain language summaries</div>
                <p className="text-sm text-muted-foreground">Scout explains where your package is and whether you should worry</p>
              </div>
              <div className="text-center p-4">
                <div className="font-medium mb-1">Real probabilities</div>
                <p className="text-sm text-muted-foreground">Based on how similar packages actually performed</p>
              </div>
              <div className="text-center p-4">
                <div className="font-medium mb-1">Confidence indicators</div>
                <p className="text-sm text-muted-foreground">Shows when we have strong data vs. limited samples</p>
              </div>
            </div>
          </section>

          {/* Automated Claims */}
          <section className="space-y-6">
            <h2 className="text-2xl font-semibold">Automated Claims</h2>
            <p className="text-muted-foreground">When a package is truly lost, we make filing easy:</p>

            <div className="space-y-4">
              <div className="flex gap-4 items-start">
                <CheckCircle2 className="w-5 h-5 text-green-500 mt-0.5" />
                <div>
                  <span className="font-medium">Automatic detection</span>
                  <span className="text-muted-foreground"> — Scout identifies when a package crosses from &quot;delayed&quot; to &quot;likely lost&quot;</span>
                </div>
              </div>
              <div className="flex gap-4 items-start">
                <CheckCircle2 className="w-5 h-5 text-green-500 mt-0.5" />
                <div>
                  <span className="font-medium">Automatic eligibility</span>
                  <span className="text-muted-foreground"> — When a carrier admits loss, Scout immediately flags the shipment as claim-ready</span>
                </div>
              </div>
              <div className="flex gap-4 items-start">
                <CheckCircle2 className="w-5 h-5 text-green-500 mt-0.5" />
                <div>
                  <span className="font-medium">Optimal timing</span>
                  <span className="text-muted-foreground"> — Scout knows the filing windows for each carrier and alerts you at the right time</span>
                </div>
              </div>
            </div>
          </section>

          {/* Why It Matters */}
          <section className="space-y-6">
            <h2 className="text-2xl font-semibold">Why It Matters</h2>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Without Delivery IQ</th>
                    <th className="text-left py-3 px-4 font-medium text-primary">With Delivery IQ</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b">
                    <td className="py-3 px-4 text-muted-foreground">Find out about lost packages from angry customers</td>
                    <td className="py-3 px-4">Scout alerts you before customers notice</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-3 px-4 text-muted-foreground">Guess whether to reship or wait</td>
                    <td className="py-3 px-4">Scout shows the actual probability of delivery</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-3 px-4 text-muted-foreground">Miss claim filing deadlines</td>
                    <td className="py-3 px-4">Scout reminds you at the optimal filing time</td>
                  </tr>
                  <tr>
                    <td className="py-3 px-4 text-muted-foreground">Spend hours tracking packages manually</td>
                    <td className="py-3 px-4">Scout-powered dashboard shows exactly what needs attention</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* Pricing */}
          <section className="space-y-4 text-center p-8 rounded-xl bg-muted/50">
            <h2 className="text-2xl font-semibold">Simple Pricing</h2>
            <p className="text-muted-foreground max-w-xl mx-auto">
              Delivery IQ is included with your Jetpack fulfillment account.
              No extra charge. No per-shipment fees.
              Just better visibility into your shipments.
            </p>
          </section>

          {/* CTA */}
          <section className="text-center space-y-4">
            <h2 className="text-2xl font-semibold">Get Started</h2>
            <p className="text-muted-foreground">
              Delivery IQ is active for all Jetpack clients. Visit your dashboard to see it in action.
            </p>
            <div className="text-lg font-medium">
              Dashboard → Delivery IQ
            </div>
            <p className="text-sm text-muted-foreground mt-8 italic">
              Delivery IQ, powered by Scout—intelligence that delivers.
            </p>
          </section>

        </div>
      </div>
    </>
  )
}
