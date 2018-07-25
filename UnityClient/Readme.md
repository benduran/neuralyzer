# Clients Supported
Currently there is only a Unity Client for the Neuralyzer system. There are no other clients currently planned, if you need one please create a fork. The only requirement currently for a Neuralyzer client is that the platform supports web sockets.
The Unity client requires at least Unity 2017.1 to enable WSA support. For WebGL and standalone builds earlier versions of Unity may work, but have not been tested. Currently Neuralyzer has been tested using WSA on the Microsoft Hololens and WebGL, other platforms may work, but have not been tested.

# Using the Unity Client
If you wish to get started quickly with the Unity client simply import the unity package inside the client folder. This should create a Neuralyzer folder inside of your projects assets. There is a Demo scene which demonstrates a simple Neuralyzer setup. 
The Unity client is very basic and is based on an event based structure. All message types are handled by the NeuraManager, which also triggers events based on what has happened (eg: OnPropertiesChanged). For basic operation simply using Neuralyzer via the NeuraManager Bridge section should provide much of the functionality that is required. 
In order to synchronize a game object it must have a component that implements the ITrackable interface. It also must be registered with NeuraManager via the AddUserObject or AddSceneObject methods. There is an example implementation in the NStateTracker which is used in the Demo scene. 

Neuralyzer is based on the idea of Rooms, which have Properties, and collections of objects, which also have properties. 

Objects can be either owned by users or by the scene. User objects should be instantiated at runtime, while Scene objects should exist during scene construction; scene objects should have a unique id given to them when they are created.
Properties currently are stored as top level object properties. These properties should be modified to fit the specific implementation's requirements. Changing the properties involves modifying the flatbuffer schema as well as the handlers for both the client and server code. It is highly recommended that tests are written to verify that the objects are correctly serialized and deserialized as this can be somewhat tricky. For further reading on flatbuffers go to http://google.github.io/flatbuffers/. This follows for both room properties (such as scene loaded, or other things all users should know) as well as user/scene object properties.

Since room properties provide functionality unique to the individual application they are not handled by the Neuralyzer plugin, but are instead simply synchronized, with changes passed to an event so that the application logic can handle them. It is recommended that some sort of filtering, such as debouncing, is used on the property changes. (this is done by default, but changes may be required depending on use case, see the debounce extension in the Extensions class)
Similar filtering may be required on object properties depending on use case.
