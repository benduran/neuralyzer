using System;
using Neuralyzer.Components;
using Neuralyzer.Core;
using UnityEngine;
using UnityEngine.UI;

namespace Demo
{
  public class CharacterController : MonoBehaviour
  {
    public GameObject characterPrefab;
    public float speed;
    public string username;
    public InputField iField;
    public GameObject startMenu;
    public GameObject playerGameObject;
    private NStateTracker playerTracker;
    private Transform pTrans;

    //Auto login with a random username on the hololens because there is no way to use the login window
  
#if UNITY_METRO && !UNITY_EDITOR
    public void Start() 
    {
      Invoke("HololensStart", 2f);
    }

    private void HololensStart()
    {
      SetUsername("HololensUser" + UnityEngine.Random.Range(0, 10001));
    } 
#endif

    public void SetUsername(string usrName)
    {
      username = string.IsNullOrEmpty(usrName) ? iField.text : usrName;
      NeuraCore.Instance.config.Username = username;
      StartCoroutine(NeuraCore.Instance.Connect());
      startMenu.SetActive(false);
      NeuraCore.Instance.socket.OnOpen += (sender, e) =>
      {
        //instantiate local player
        playerGameObject = Instantiate(characterPrefab);
        pTrans = playerGameObject.transform;
        playerTracker = playerGameObject.GetComponent<NStateTracker>();
        //set player to have correct info
        playerTracker.id = UnityEngine.Random.Range(int.MinValue,int.MaxValue);
        playerTracker.ownerId = username;
        playerGameObject.GetComponent<Renderer>().material.color = Color.red;
        playerTracker.Init();
      };
    }

    public void Update()
    {
      if (playerGameObject)
      {
        pTrans.Translate(Input.GetAxis("Horizontal") * speed * Time.deltaTime,
          Input.GetAxis("Vertical") * speed * Time.deltaTime, 0f);
      }
    }

  }
}
