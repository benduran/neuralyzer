using System;
using System.Collections.Generic;
using Neuralyzer.Core;
using Neuralyzer.Transport;
using UnityEngine;

namespace Neuralyzer.Components
{
  public class NStateTracker : MonoBehaviour, ITrackable
  {
    #region Itrackable properties //to get around interfaces not liking fields
    public string prefab
    {
      get { return Prefab; }
      set { Prefab = value; }
    }

    public int id
    {
      get { return Id; }
      set { Id = value; }
    }
    public bool isLocal { get; set; }

    int ITrackable.id
    {
      get
      {
        throw new NotImplementedException();
      }

      set
      {
        throw new NotImplementedException();
      }
    }
    #endregion
    [Tooltip("Only set for scene objects. Use something descriptive and unique")]
    public int Id;
    [HideInInspector]
    public string ownerId;
    [Tooltip("Only set this true if the object does not need to be loaded at runtime. eg: an object built into the scene")]
    public bool isSceneObject;
    [Tooltip("This is the name of the prefab that will be spawned on remote machines. It does NOT need to match the local prefab")]
    public string Prefab;
    [HideInInspector]
    public new Transform transform;
    public float lerpSpeed;
    [Tooltip("Lock this Tracker to another transform without parenting")]
    public Transform constrainToTransform;
    [Tooltip("Should this object be destroyed on the server when the player logs out")]
    public bool destroyOnLogout;
    private Vector3 actualPosition;
    private Vector3 actualLook = Vector3.forward;

    public void Awake()
    {
      transform = GetComponent<Transform>();
    }

    public void Start()
    {
      if (isSceneObject)
        Init();
    }

    public void Init()
    {
      if (!NeuraManager.Instance.AddSceneObject(this)
      ) //try to add to global state and if object already exists destroy this one
      {
        Destroy(gameObject);
        return;
      }
      isLocal = NeuraCore.Instance.config.Username == ownerId;
    }

    public TrackedObject ToTrackedObject()
    {
      return new TrackedObject
      {
        isActive = gameObject.activeInHierarchy,
        lookDirection = transform.forward,
        objectId = id,
        ownerId = ownerId,
        position = transform.position,
        prefab = prefab
      };
    }

    public RoomObjectObj ToRoomObject()
    {
      return new RoomObjectObj
      {
        id = id,
        position = actualPosition,
        lookDirection = actualLook,
        owner = ownerId,
        prefab = prefab
      };
    }

    public void UpdateFromRoomObject(RoomObjectObj stateRoomObject)
    {
      //should call moveto and lookat

    }

    public void MoveTo(Vector3 newPos)
    {
      actualPosition = newPos;
    }

    public void LookAt(Vector3 newLook)
    {
      actualLook = newLook;
    }

    public void Update()
    {
      if (constrainToTransform)
      {
        actualPosition = constrainToTransform.position;
        actualLook = constrainToTransform.forward;
      }
      if (!constrainToTransform && isLocal) return;
      if (transform.position != actualPosition)
        transform.position = Vector3.MoveTowards(transform.position, actualPosition, lerpSpeed * Time.deltaTime);
      if (transform.forward != actualLook)
        transform.forward = Vector3.MoveTowards(transform.forward, actualLook, lerpSpeed * Time.deltaTime);
    }
  }
}
