import { useEffect, useRef, useState } from "react";
import { api } from "../services/api";

type Photo = { mime: string; content: string } | null;

export function ProductThumbnail({
  product,
  warehouse,
}: {
  product: string;
  warehouse: string;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [photo, setPhoto] = useState<Photo>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );

  useEffect(() => {
    let active = true;
    let requested = false;
    const load = () => {
      if (requested) return;
      requested = true;
      void api<Photo>(
        `/workspace/reference-photos/${encodeURIComponent(product)}`,
        warehouse,
      )
        .then((result) => {
          if (!active) return;
          setPhoto(result);
          setStatus("ready");
        })
        .catch(() => {
          if (active) setStatus("error");
        });
    };

    const element = frame.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      load();
      return () => {
        active = false;
      };
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          load();
        }
      },
      { rootMargin: "100px" },
    );
    observer.observe(element);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [product, warehouse]);

  const hasPhoto = status === "ready" && photo;
  const label =
    status === "loading"
      ? "Memuat foto"
      : status === "error"
        ? "Foto tidak tersedia"
        : hasPhoto
          ? `Foto referensi ${product}`
          : "Belum ada foto terakhir";

  return (
    <div
      className="inspection-product-thumbnail"
      role="img"
      aria-label={label}
      ref={frame}
    >
      {hasPhoto ? (
        <img
          src={`data:${photo.mime};base64,${photo.content}`}
          alt=""
          aria-hidden="true"
        />
      ) : (
        <span>{label}</span>
      )}
    </div>
  );
}
