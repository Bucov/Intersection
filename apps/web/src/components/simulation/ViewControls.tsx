import { useNavigate } from "react-router";
import { ArrowLeft, Crosshair } from "lucide-react";
import { useServices } from "@/app/services";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { CameraView } from "@/state/scene";
import { useStore } from "@/state/store";

export function ViewControls() {
  const { scene } = useServices();
  const navigate = useNavigate();
  const cameraView = useStore(scene, s => s.cameraView);
  const webgl = useStore(scene, s => s.webgl);

  return (
    <div className="pointer-events-auto flex items-center gap-1 rounded-lg border bg-panel p-1 shadow-[0_12px_28px_-18px_rgb(0_0_0/0.9)]">
      <Button size="sm" variant="ghost" className="h-8" onClick={() => navigate("/")}>
        <ArrowLeft data-icon="inline-start" />
        Home
      </Button>
      <span className="mx-0.5 h-5 w-px bg-border" aria-hidden="true" />
      <ToggleGroup
        value={[cameraView]}
        onValueChange={value => value[0] && scene.setState(s => ({ ...s, cameraView: value[0] as CameraView }))}
        size="sm"
        spacing={0}
        aria-label="Camera view"
        disabled={webgl !== "ok"}
      >
        <ToggleGroupItem value="angled" className="h-8 px-2.5 text-[0.8125rem]">Angled</ToggleGroupItem>
        <ToggleGroupItem value="top" className="h-8 px-2.5 text-[0.8125rem]">Top</ToggleGroupItem>
      </ToggleGroup>
      <Tooltip>
        <TooltipTrigger render={<Button size="icon-sm" variant="ghost" className="size-8" aria-label="Reset camera" disabled={webgl !== "ok"} onClick={() => scene.setState(s => ({ ...s, recenter: s.recenter + 1 }))} />}>
          <Crosshair />
        </TooltipTrigger>
        <TooltipContent>Reset the camera. Drag to orbit, right-drag to pan, scroll to zoom.</TooltipContent>
      </Tooltip>
    </div>
  );
}
