import dynamic from "next/dynamic"
import { SiteHeader } from "@/components/site-header"
import { JetpackLoader } from "@/components/jetpack-loader"

const CareContent = dynamic(() => import("./care-content"), {
  loading: () => (
    <>
      <SiteHeader sectionName="Jetpack Care">
        <div className="flex items-center gap-1.5 ml-[10px]">
          <JetpackLoader size="md" />
        </div>
      </SiteHeader>
      <div className="flex flex-1 flex-col bg-background rounded-t-xl" />
    </>
  ),
})

export default function CarePage() {
  return <CareContent />
}
