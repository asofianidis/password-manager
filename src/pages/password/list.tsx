import { type NextPage } from "next";
import Head from "next/head";
import Modal from "../../components/layout/Modal";
import CreateNewPasswordForm from "~/components/password/CreateNewPasswordForm";
import { api } from "~/utils/api";
import PasswordSettingsForm from "~/components/password/PasswordSettingsForm";

const PasswordList: NextPage = () => {
  const { data: passwords, isLoading } = api.password.getPasswords.useQuery();

  if (isLoading) {
    return <div>Loading...</div>;
  }

  return (
    <>
      <Head>
        <title>Create T3 App</title>
        <meta name="description" content="Generated by create-t3-app" />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <div className="flex flex-row">
        <div>
          <Modal buttonText="Add new Password" modalTitle="Add New Password">
            <CreateNewPasswordForm />
          </Modal>
        </div>
        <div className="ml-4">
          <Modal
            buttonText="Password Settings"
            modalTitle="Password Settings"
          >
            <PasswordSettingsForm />
          </Modal>
        </div>
      </div>
      <div>
        {passwords && passwords.length == 0 ? "No Passwords" : "Passwords"}
      </div>
    </>
  );
};

export default PasswordList;
