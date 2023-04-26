import { useState } from "react";
import { api } from "~/utils/api";

function PasswordSettingsForm() {
  const [passwordLength, setPasswordLength] = useState(16);
  const [passwordLowerCase, setPasswordLowerCase] = useState(false);
  const [passwordUpperCase, setPasswordUpperCase] = useState(false);
  const [passwordNumbers, setPasswordNumbers] = useState(false);
  const [passwordSymbols, setPasswordSymbols] = useState(false);

  return (
    <form>
      <div className="mb-4 flex flex-col">
        <label htmlFor="passwordLength" className="text-white">
          Password Length{" "}
          <span className="text-gray-400">{`(${passwordLength})`}</span>
        </label>
        <input
          type="range"
          step={1}
          min={8}
          max={40}
          value={passwordLength}
          onChange={(e) => {
            setPasswordLength(parseInt(e.target.value));
          }}
        />
      </div>

      <div className="flex flex-row">
        <label htmlFor="passwordLowerCase" className="mr-4 text-white">
          Lower Case Letters
        </label>
        <label className="relative inline-flex cursor-pointer items-center">
          <input
            checked={passwordLowerCase}
            type="checkbox"
            value=""
            className="peer sr-only"
            onChange={(e) => {
              setPasswordLowerCase(e.target.checked);
            }}
          />
          <div className="peer h-6 w-11 rounded-full bg-gray-200 after:absolute after:top-[2px] after:left-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-blue-600 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:border-gray-600 dark:bg-gray-300 dark:peer-focus:ring-blue-800"></div>
          <span className="ml-3 text-sm font-medium text-gray-900 dark:text-gray-300"></span>
        </label>
      </div>
    </form>
  );
}

export default PasswordSettingsForm;
