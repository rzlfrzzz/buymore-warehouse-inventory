# Reference and inspection photos

- Upload limit remains 2,097,152 bytes (2 MB). Decoded images are limited to 25 million pixels and a single page.
- The backend fully decodes JPEG/PNG with sharp and checks PNG chunk CRCs and IEND. Truncated, corrupt, unsupported and signature-only files are rejected.
- A filename or browser MIME is not proof of format. A valid PNG named `.jpg` is stored unchanged with `image/png`; no lossy conversion is needed. Other formats must be exported as JPEG/PNG first.
- Reference uploads remain Admin-only and warehouse-scoped. Inspection captures retain owner/Admin and warehouse read restrictions. No schema or permission migration is required.
- sharp 0.34 supports the existing Node 22 Alpine Docker image through its Linux musl optional packages. Keep optional dependencies enabled when installing; rebuild the backend image rather than copying Windows node_modules. Docker execution is not covered by local Windows verification.

## Regression coverage

`backend/test/reference-photo.test.ts` uses isolated PGlite migrations and synthetic PNG bytes submitted as `image/jpeg`. An optional `PHOTO_SAMPLE` environment variable points to a local image for the same handler checks; no private image is included in the repository. `PHOTO_EXPECT_REJECTION=1` is only for reproducing the old implementation's rejection.

`backend/test/photo.test.ts` covers standard/progressive JPEG, trailing JPEG data, PNG CRC corruption, truncation, signature spoofing, unsupported formats and decoded-size limits. Frontend MIME/filename and upload-size tests are in `frontend/src/utils/photoUpload.test.ts`.