import { useState } from "react";
import { api } from "~/utils/api";
import LoadingSpinner from "../layout/LoadingSpinner";

function PasswordSettingsForm() {
  const updatePasswordSettings =
    api.passwordSettings.updatePasswordSettings.useMutation();
  const { data: passwordSettings, isLoading } =
    api.passwordSettings.getPasswordSettings.useQuery();
  const [passwordLength, setPasswordLength] = useState(16);
  const [passwordLowerCase, setPasswordLowerCase] = useState(false);
  const [passwordUpperCase, setPasswordUpperCase] = useState(false);
  const [passwordNumbers, setPasswordNumbers] = useState(false);
  const [passwordSymbols, setPasswordSymbols] = useState(false);

  const handleSubmit = () => {
    updatePasswordSettings.mutate({
      passwordLength,
      passwordLowercase: passwordLowerCase,
      passwordNumbers,
      passwordSymbols,
      passwordUppercase: passwordUpperCase
    })
  }

  if (isLoading) {
    return (
      <LoadingSpinner />
    );
  } else {

    if(passwordSettings != undefined){
      setPasswordLength(passwordSettings.length)
      setPasswordLowerCase(passwordSettings.lowercase);
      setPasswordNumbers(passwordSettings.numbers);
      setPasswordUpperCase(passwordSettings.uppercase);
      setPasswordSymbols(passwordSettings.symbols)
    }

    return (
      <form onSubmit={(e) => {
        e.preventDefault();
        handleSubmit();
      }}>
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

        <div className="mt-5 flex flex-row">
          <label className="mr-4 text-white">Upper Case Letters</label>
          <label className="relative inline-flex cursor-pointer items-center">
            <input
              type="checkbox"
              value=""
              className="peer sr-only"
              checked={passwordUpperCase}
              onChange={(e) => {
                setPasswordUpperCase(e.target.checked);
              }}
            />
            <div className="peer h-6 w-11 rounded-full bg-gray-200 after:absolute after:top-[2px] after:left-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-blue-600 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:border-gray-600 dark:bg-gray-300 dark:peer-focus:ring-blue-800"></div>
            <span className="ml-3 text-sm font-medium text-gray-900 dark:text-gray-300"></span>
          </label>
        </div>

        <div className="mt-5 flex flex-row">
          <label className="mr-20 text-white">Numbers</label>
          <label className="relative inline-flex cursor-pointer items-center">
            <input
              type="checkbox"
              value=""
              className="peer sr-only"
              checked={passwordNumbers}
              onChange={(e) => {
                setPasswordNumbers(e.target.checked);
              }}
            />
            <div className="peer h-6 w-11 rounded-full bg-gray-200 after:absolute after:top-[2px] after:left-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-blue-600 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:border-gray-600 dark:bg-gray-300 dark:peer-focus:ring-blue-800"></div>
            <span className="ml-3 text-sm font-medium text-gray-900 dark:text-gray-300"></span>
          </label>
        </div>

        <div className="mt-5 flex flex-row">
          <label className="mr-4 text-white">Special Characters</label>
          <label className="relative inline-flex cursor-pointer items-center">
            <input
              type="checkbox"
              value=""
              className="peer sr-only"
              checked={passwordSymbols}
              onChange={(e) => {
                setPasswordSymbols(e.target.checked);
              }}
            />
            <div className="peer h-6 w-11 rounded-full bg-gray-200 after:absolute after:top-[2px] after:left-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-blue-600 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:border-gray-600 dark:bg-gray-300 dark:peer-focus:ring-blue-800"></div>
            <span className="ml-3 text-sm font-medium text-gray-900 dark:text-gray-300"></span>
          </label>
        </div>

        <div className="mt-5">
          <button
            type="submit"
            className="mr-2 mb-2 rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-800 focus:outline-none focus:ring-4 focus:ring-blue-300 dark:bg-blue-600 dark:hover:bg-blue-700 dark:focus:ring-blue-800"
          >
            Save
          </button>
        </div>
      </form>
    );
  }
}

export default PasswordSettingsForm;
