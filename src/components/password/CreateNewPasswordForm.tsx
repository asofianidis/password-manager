import { useState } from "react";
import { api } from "../../utils/api";
import { generatePassword } from "~/utils/passwordGenerate";
import LoadingSpinner from "../layout/LoadingSpinner";

function CreateNewPasswordForm() {
  const { data: passwordSettings, isLoading } =
    api.passwordSettings.getPasswordSettings.useQuery();
  const [website, setWebsite] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isHidden, setIsHidden] = useState(true);

  if (isLoading) return <LoadingSpinner />;

  const passwordInputType = isHidden ? "password" : "text";

  const handleGeneratePassword = () => {
    if (passwordSettings != null || passwordSettings != undefined) {
      const passwordLength = passwordSettings.length;
      const passwordUpperCase = passwordSettings.uppercase;
      const passwordLowerCase = passwordSettings.lowercase;
      const passwordNumbers = passwordSettings.numbers;
      const passwordSymbols = passwordSettings.symbols;

      setPassword(
        generatePassword(
          passwordLength,
          passwordUpperCase,
          passwordLowerCase,
          passwordNumbers,
          passwordSymbols
        )
      );
    }
  };

  if (passwordSettings == null || passwordSettings == undefined) {
    return (
      <p className="text-white">
        Your account currently has no password settings. Please create your
        password settings before using the generate password function.
      </p>
    );
  } else {
    return (
      <form>
        <div className="mb-4 flex flex-col text-white">
          <label htmlFor="website">Website</label>
          <input
            type="text"
            name="website"
            id="website"
            placeholder="Website"
            className="mt-2 rounded bg-gray-800 p-2"
            onChange={(e) => {
              setWebsite(e.target.value);
            }}
            value={website}
          />
        </div>
        <div className="mb-4 flex flex-col text-white">
          <label htmlFor="username">Username</label>
          <input
            type="text"
            name="username"
            id="username"
            placeholder="Username"
            className="mt-2 rounded bg-gray-800 p-2"
            onChange={(e) => {
              setUsername(e.target.value);
            }}
            value={username}
          />
        </div>
        <div className="flex flex-col text-white">
          <label htmlFor="">Password</label>
          <input
            type={passwordInputType}
            name="password"
            id="password"
            placeholder="Password"
            className="mt-2 rounded bg-gray-800 p-2"
            onChange={(e) => {
              setPassword(e.target.value);
            }}
            value={password}
          />
          <div className="mt-4 flex flex-row">
            <button
              onClick={handleGeneratePassword}
              type="button"
              className="mr-2 mb-2 rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-800 focus:outline-none focus:ring-4 focus:ring-blue-300 dark:bg-blue-600 dark:hover:bg-blue-700 dark:focus:ring-blue-800"
            >
              Generate
            </button>
            <button
              onClick={() => {
                setIsHidden(!isHidden);
              }}
              type="button"
              className="mr-2 mb-2 rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-800 focus:outline-none focus:ring-4 focus:ring-blue-300 dark:bg-blue-600 dark:hover:bg-blue-700 dark:focus:ring-blue-800"
            >
              Show Password
            </button>
          </div>
        </div>

        <div>
          <button
            type="submit"
            className="mr-2 mb-2 rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-800 focus:outline-none focus:ring-4 focus:ring-blue-300 dark:bg-blue-600 dark:hover:bg-blue-700 dark:focus:ring-blue-800"
          >
            Save Password
          </button>
        </div>
      </form>
    );
  }
}

export default CreateNewPasswordForm;
