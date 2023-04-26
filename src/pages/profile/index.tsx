import { type NextPage } from "next";
import Layout from "~/components/layout/Layout";
import { api } from "../../utils/api"
import { useSession } from "next-auth/react";
import LoadingSpinner from "~/components/layout/LoadingSpinner";

const ProfilePage: NextPage = () => {
    const {data: session} = useSession();
    const {data: passwords, isLoading: isPasswordLoading} = api.password.getPasswords.useQuery()


  return (
    <>
      <Layout>
        <div className="flex flex-col items-center">
            <div className="bg-gray-700 p-2 rounded">
                <div className="flex flex-row">
                    <div className="flex flex-col border-r-2">
                        <div className="flex flex-row m-2">
                            <p>Number of Passwords: {passwords?.length}</p>
                        </div>
                        <div className="flex flex-col">
                            
                        </div>
                    </div>
                </div>
            </div>
        </div>
      </Layout>
    </>
  );
};

export default ProfilePage;
