import { useEffect, useState } from 'react'
import { auth } from '../firebase/auth'
import Navbar from '../components/Navbar'
import { API_URL } from '../config'

function Profile() {

  const [profile, setProfile] = useState(null)
  const [editing, setEditing] = useState(false)

  const handleSaveProfile = async () => {

    try {

      await fetch(
        `${API_URL}/profile/${profile.id}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            telefone: profile.telefone,
            codigo_pais: profile.codigo_pais,
            cidade: profile.cidade,
            morada: profile.morada,
            cep: profile.cep
          })
        }
      )

      alert('Profile updated successfully!')

      setEditing(false)

    } catch (error) {

      console.log(error)

      alert('Error updating profile')

    }

  }

  useEffect(() => {

    const loadProfile = async () => {

      if (!auth.currentUser) {
        return
      }

      try {

        const email = auth.currentUser.email

        const userResponse = await fetch(
          `${API_URL}/users/email/${email}`
        )

        const userData = await userResponse.json()

        const profileResponse = await fetch(
          `${API_URL}/profile/${userData.id}`
        )

        const profileData = await profileResponse.json()

        setProfile(profileData)

      } catch (error) {

        console.log(error)

      }

    }

    const timer = setTimeout(() => {

      loadProfile()

    }, 500)

    return () => clearTimeout(timer)

  }, [])

  if (!profile) {

    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        Loading...
      </div>
    )

  }

  return (

    <div className="min-h-screen bg-black text-white">

      <Navbar />

      <div className="p-10 pt-36">

        <div className="max-w-5xl mx-auto">

          <h1
            style={{ fontFamily: 'Bebas Neue' }}
            className="text-6xl mb-12"
          >
            Profile
          </h1>

          <div className="border border-white/10 p-10 rounded-2xl">

            <div className="flex flex-col items-center mb-12">

              <img
                src={
                  profile.foto ||
                  `https://ui-avatars.com/api/?name=${encodeURIComponent(profile.nome)}`
                }
                alt="Profile"
                className="w-32 h-32 rounded-full mb-6 border border-white/20"
              />

              <h2 className="text-3xl mb-2">
                {profile.nome}
              </h2>

              <p className="text-gray-400">
                {profile.email}
              </p>

            </div>

            <div className="grid md:grid-cols-2 gap-8">

              <div>

                <p className="text-gray-400 mb-2">
                  Member ID
                </p>

                <h3 className="text-2xl">
                  {profile.id}
                </h3>

              </div>

              <div>

                <p className="text-gray-400 mb-2">
                  Active Plan
                </p>

                <h3 className="text-2xl">
                  {profile.plano || 'No Plan Assigned'}
                </h3>

              </div>

              <div>

                <p className="text-gray-400 mb-2">
                  Phone Number
                </p>

                {editing ? (

                  <div className="flex gap-2">

                    <input
                      value={profile.codigo_pais || ''}
                      onChange={(e) =>
                        setProfile({
                          ...profile,
                          codigo_pais: e.target.value
                        })
                      }
                      className="bg-black border border-white/20 px-3 py-2 rounded-lg w-24"
                    />

                    <input
                      value={profile.telefone || ''}
                      onChange={(e) =>
                        setProfile({
                          ...profile,
                          telefone: e.target.value
                        })
                      }
                      className="bg-black border border-white/20 px-3 py-2 rounded-lg flex-1"
                    />

                  </div>

                ) : (

                  <h3 className="text-xl">
                    {profile.codigo_pais || ''} {profile.telefone || 'Not provided'}
                  </h3>

                )}

              </div>

              <div>

                <p className="text-gray-400 mb-2">
                  City
                </p>

                {editing ? (

                  <input
                    value={profile.cidade || ''}
                    onChange={(e) =>
                      setProfile({
                        ...profile,
                        cidade: e.target.value
                      })
                    }
                    className="bg-black border border-white/20 px-3 py-2 rounded-lg w-full"
                  />

                ) : (

                  <h3 className="text-xl">
                    {profile.cidade || 'Not provided'}
                  </h3>

                )}

              </div>

              <div>

                <p className="text-gray-400 mb-2">
                  Address
                </p>

                {editing ? (

                  <input
                    value={profile.morada || ''}
                    onChange={(e) =>
                      setProfile({
                        ...profile,
                        morada: e.target.value
                      })
                    }
                    className="bg-black border border-white/20 px-3 py-2 rounded-lg w-full"
                  />

                ) : (

                  <h3 className="text-xl">
                    {profile.morada || 'Not provided'}
                  </h3>

                )}

              </div>

              <div>

                <p className="text-gray-400 mb-2">
                  ZIP Code
                </p>

                {editing ? (

                  <input
                    value={profile.cep || ''}
                    onChange={(e) =>
                      setProfile({
                        ...profile,
                        cep: e.target.value
                      })
                    }
                    className="bg-black border border-white/20 px-3 py-2 rounded-lg w-full"
                  />

                ) : (

                  <h3 className="text-xl">
                    {profile.cep || 'Not provided'}
                  </h3>

                )}

              </div>

            </div>

            <div className="mt-12 flex justify-center">

              {!editing ? (

                <button
                  onClick={() => setEditing(true)}
                  className="border border-white/20 px-8 py-4 rounded-lg uppercase tracking-[3px] hover:bg-white hover:text-black transition duration-300"
                >
                  Edit Profile
                </button>

              ) : (

                <button
                  onClick={handleSaveProfile}
                  className="bg-white text-black px-8 py-4 rounded-lg uppercase tracking-[3px] hover:bg-gray-300 transition duration-300"
                >
                  Save Changes
                </button>

              )}

            </div>

          </div>

        </div>

      </div>

    </div>

  )

}

export default Profile