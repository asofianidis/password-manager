import { useState } from "react";
import { api } from "~/utils/api";

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
      <>
        <div role="status">
          <svg
            aria-hidden="true"
            className="mr-2 h-8 w-8 animate-spin fill-blue-600 text-gray-200 dark:text-gray-600"
            viewBox="0 0 100 101"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M100 50.5908C100 78.2051 77.6142 100.591 50 100.591C22.3858 100.591 0 78.2051 0 50.5908C0 22.9766 22.3858 0.59082 50 0.59082C77.6142 0.59082 100 22.9766 100 50.5908ZM9.08144 50.5908C9.08144 73.1895 27.4013 91.5094 50 91.5094C72.5987 91.5094 90.9186 73.1895 90.9186 50.5908C90.9186 27.9921 72.5987 9.67226 50 9.67226C27.4013 9.67226 9.08144 27.9921 9.08144 50.5908Z"
              fill="currentColor"
            />
            <path
              d="M93.9676 39.0409C96.393 38.4038 97.8624 35.9116 97.0079 33.5539C95.2932 28.8227 92.871 24.3692 89.8167 20.348C85.8452 15.1192 80.8826 10.7238 75.2124 7.41289C69.5422 4.10194 63.2754 1.94025 56.7698 1.05124C51.7666 0.367541 46.6976 0.446843 41.7345 1.27873C39.2613 1.69328 37.813 4.19778 38.4501 6.62326C39.0873 9.04874 41.5694 10.4717 44.0505 10.1071C47.8511 9.54855 51.7191 9.52689 55.5402 10.0491C60.8642 10.7766 65.9928 12.5457 70.6331 15.2552C75.2735 17.9648 79.3347 21.5619 82.5849 25.841C84.9175 28.9121 86.7997 32.2913 88.1811 35.8758C89.083 38.2158 91.5421 39.6781 93.9676 39.0409Z"
              fill="currentFill"
            />
          </svg>
          <span className="sr-only">Loading...</span>
        </div>
      </>
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
