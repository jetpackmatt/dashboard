import { SiteHeader } from "@/components/site-header"
import { JetpackLoader } from "@/components/jetpack-loader"

export default function Loading() {
  return (
    <>
      <SiteHeader sectionName="Jetpack Care">
        <div className="flex items-center gap-1.5 ml-[10px]">
          <JetpackLoader size="md" />
        </div>
      </SiteHeader>
      <div className="flex flex-1 flex-col bg-background rounded-t-xl" />
    </>
  )
}
