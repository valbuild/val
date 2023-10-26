import { FC, useEffect, useState } from "react";
import Button from "./Button";

interface UploadModalProps {
  showModal: boolean;
  setShowModal: React.Dispatch<React.SetStateAction<boolean>>;
  uploadImage: (url: string, alt?: string) => void;
}

const UploadModal: FC<UploadModalProps> = ({
  showModal,
  setShowModal,
  uploadImage,
}) => {
  const [uploadUrl, setUploadUrl] = useState<boolean>(true);
  const [url, setUrl] = useState<string>("");

  useEffect(() => {
    setUrl("");
  }, [uploadUrl]);

  const loadImage = (files: FileList | null) => {
    const reader = new FileReader();
    reader.onload = function () {
      if (typeof reader.result === "string") {
        setUrl(reader.result);
      }
      return "";
    };
    if (files !== null) {
      reader.readAsDataURL(files[0]);
    }
  };

  const onSubmit = () => {
    if (url) {
      uploadImage(url);
      setUrl("");
      setShowModal(false);
      setUploadUrl(true);
    }
  };

  return (
    <div className="val-absolute val-z-10 val-flex val-flex-col val-justify-center val-items-center val-top-[50%] val-left-[50%] val-font-mono">
      {showModal && (
        <div className="val-flex val-flex-col val-items-center val-justify-center">
          <div className="val-flex val-flex-col val-items-start val-justify-center val-min-h-screen val-px-4 val-pt-4 val-pb-20 val-text-center sm:val-block sm:val-p-0">
            <div className="val-fixed val-inset-0 val-transition-opacity">
              <div className="val-absolute val-inset-0 val-bg-gray-500 val-opacity-75" />
            </div>

            <div className="val-flex val-flex-col val-items-center val-justify-between val-bg-fill val-rounded-lg val-transform val-transition-all val-min-h-[300px] min-w-[500px] val-h-full val-px-5 val-py-7">
              <div className="flex flex-col items-center w-full gap-5">
                <div className="mb-4">
                  <Button
                    variant={uploadUrl ? "primary" : "secondary"}
                    onClick={() => setUploadUrl(true)}
                  >
                    Paste URL
                  </Button>
                  <Button
                    variant={uploadUrl ? "secondary" : "primary"}
                    onClick={() => setUploadUrl(false)}
                  >
                    Upload file
                  </Button>
                </div>
                {uploadUrl ? (
                  <div className="flex flex-col items-center justify-center w-full gap-5">
                    <label className="text-primary">Upload URL</label>
                    <input
                      className="w-full h-10 rounded-lg bg-border"
                      value={url}
                      onChange={(event) => setUrl(event.target.value)}
                    />
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center w-full gap-5">
                    <label className="text-primary">Choose File</label>
                    <input
                      className="h-10 rounded-lg w-fit"
                      type="file"
                      onChange={(e) => loadImage(e.target.files)}
                    />
                  </div>
                )}
              </div>
              <div className="flex flex-row items-center justify-center gap-5 ">
                <Button variant="secondary" onClick={() => setShowModal(false)}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  disabled={url === ""}
                  onClick={() => onSubmit()}
                >
                  Upload
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UploadModal;
