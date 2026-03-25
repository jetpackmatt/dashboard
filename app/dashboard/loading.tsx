import { JetpackLoader } from "@/components/jetpack-loader"

export default function DashboardLoading() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <JetpackLoader size="lg" />
    </div>
  )
}
