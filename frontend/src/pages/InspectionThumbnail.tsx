import { useEffect, useRef, useState } from "react";
import { api } from "../services/api";

type Props = { photo?: string | null; warehouse: string; inspection: string };
type Photo = { mime: string; content: string };

export function InspectionThumbnail(props: Props) {
  // Reset immediately on context changes; pending requests belong to the old frame.
  return (
    <Thumbnail
      key={JSON.stringify([props.warehouse, props.inspection, props.photo])}
      {...props}
    />
  );
}

function Thumbnail({ photo, warehouse, inspection }: Props) {
  const frame = useRef<HTMLDivElement>(null);
  const [image, setImage] = useState<Photo | null>(null);
  const [status, setStatus] = useState(photo ? "loading" : "missing");

  useEffect(() => {
    if (!photo) return;
    let active = true;
    let requested = false;
    const load = () => {
      if (!active || requested) return;
      requested = true;
      void api<Photo | null>(
        `/workspace/photos/${encodeURIComponent(photo)}`,
        warehouse,
      )
        .then((result) => {
          if (!active) return;
          if (!result?.mime || !result.content) {
            setStatus("error");
            return;
          }
          setImage(result);
          setStatus("ready");
        })
        .catch(() => {
          if (active) setStatus("error");
        });
    };
    let observer: IntersectionObserver | undefined;
    if (frame.current && typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            observer?.disconnect();
            load();
          }
        },
        { rootMargin: "100px" },
      );
      observer.observe(frame.current);
    } else {
      load();
    }
    return () => {
      active = false;
      observer?.disconnect();
    };
  }, [photo, warehouse]);

  const label =
    status === "missing"
      ? "Belum ada bukti foto"
      : status === "loading"
        ? "Memuat bukti foto"
        : status === "error"
          ? "Bukti foto tidak tersedia"
          : `Bukti foto inspeksi ${inspection}`;
  return (
    <div
      ref={frame}
      className="inspection-review-thumbnail"
      role="img"
      aria-label={label}
    >
      {status === "ready" && image ? (
        <img
          src={`data:${image.mime};base64,${image.content}`}
          alt=""
          aria-hidden="true"
          onError={() => {
            setImage(null);
            setStatus("error");
          }}
        />
      ) : (
        <span>{label}</span>
      )}
    </div>
  );
}
