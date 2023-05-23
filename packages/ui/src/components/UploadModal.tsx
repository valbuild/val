import { FC, useEffect, useState } from "react";
import Button from "./Button";
import Checkbox from "./Checkbox";

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
    <div className="absolute z-10 flex flex-col justify-center items-center top-[50%] left-[50%] font-mono">
      {showModal && (
        <div className="flex flex-col items-center justify-center">
          <div className="flex flex-col items-start justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 transition-opacity">
              <div className="absolute inset-0 bg-gray-500 opacity-75" />
            </div>

            <div className="flex flex-col items-center justify-between bg-valWarmBlack rounded-lg transform transition-all min-h-[300px] min-w-[500px] h-full px-5 py-7">
              <div className="flex flex-col gap-5 w-full items-center">
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
                    <label className="text-valWhite">Upload URL</label>
                    <input
                      className="w-full h-10 bg-valDarkGrey rounded-lg"
                      value={url}
                      onChange={(event) => setUrl(event.target.value)}
                    />
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center w-full gap-5">
                    <label className="text-valWhite">Choose File</label>
                    <input
                      className="w-fit h-10 rounded-lg"
                      type="file"
                      onChange={(e) => loadImage(e.target.files)}
                    />
                  </div>
                )}
              </div>
              <div className="flex flex-row justify-center items-center gap-5 ">
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
